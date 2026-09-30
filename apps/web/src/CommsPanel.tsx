import { useState } from "react";
import type { MessageDto, StateDto } from "@st/shared";
import { api } from "./api";

type Channel = "direct" | "radio" | "broadcast" | "corp";
type Filter = "all" | "chat" | "combat" | "trade";

const TONE: Record<string, string> = {
  corp: "chat", dm: "chat", radio: "chat", comm: "chat", tavern: "chat",
  combat: "bad", limpet: "bad", trade: "good", shop: "good", reset: "good",
};
const GROUP: Record<Filter, (kind: string) => boolean> = {
  all: () => true,
  chat: (k) => ["dm", "radio", "comm", "corp", "tavern"].includes(k),
  combat: (k) => ["combat", "limpet", "deploy"].includes(k),
  trade: (k) => ["trade", "shop", "planet", "reset", "info"].includes(k),
};

/** The log, with filters, plus a compose bar for direct messages, the sector radio, and the galaxy channel. */
export function CommsPanel({ gameId, state, log, onSent }: { gameId: number; state: StateDto; log: MessageDto[]; onSent: () => void }) {
  const p = state.player;
  const [channel, setChannel] = useState<Channel>("direct");
  const [to, setTo] = useState("");
  const [text, setText] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [traffic, setTraffic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const send = async () => {
    setBusy(true); setErr("");
    try {
      if (channel === "direct") await api.sendDirect(gameId, to, text);
      else if (channel === "radio") await api.radio(gameId, text);
      else if (channel === "broadcast") await api.broadcast(gameId, text);
      else await api.corpSay(gameId, text);
      setText("");
      onSent();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  const shown = log.filter((m) => GROUP[filter](m.kind) && (traffic || m.kind !== "traffic"));
  const replyTo = (m: MessageDto) => {
    const match = m.kind === "dm" ? m.text.match(/^(.+?) → you:/) : null;
    return match?.[1] ?? null;
  };

  return (
    <div className="comms">
      <div className="compose">
        <select value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
          <option value="direct">Direct message</option>
          <option value="radio">Sector {p.sector} radio</option>
          <option value="broadcast">Authority channel (everyone)</option>
          {p.corp && <option value="corp">{p.corp.name} channel</option>}
        </select>
        {channel === "direct" && <input className="to" value={to} placeholder="Trader name" onChange={(e) => setTo(e.target.value)} />}
        <input className="msg" value={text} maxLength={400} placeholder="Message"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && text.trim() && (channel !== "direct" || to.trim())) send(); }} />
        <button className="primary" disabled={busy || !text.trim() || (channel === "direct" && !to.trim())} onClick={send}>Send</button>
      </div>
      {err && <div className="error">{err}</div>}
      <div className="log-filters">
        {(["all", "chat", "combat", "trade"] as Filter[]).map((f) => (
          <button key={f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
            {f === "all" ? "Everything" : f === "chat" ? "Messages" : f === "combat" ? "Combat" : "Trade and planets"}
          </button>
        ))}
        <label className="inline small"><input type="checkbox" checked={traffic} onChange={(e) => setTraffic(e.target.checked)} /> Ship traffic</label>
      </div>
      <ul className="log">
        {shown.length === 0 && <li className="muted">Nothing here yet. Messages, trades, purchases, and attacks on you show up here, even while you're offline.</li>}
        {shown.map((m) => {
          const who = replyTo(m);
          return (
            <li key={m.id} className={`${TONE[m.kind] ?? ""}${m.read ? "" : " unread"}`}>
              <time>{new Date(m.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time>
              {m.text}
              {who && <button className="link" onClick={() => { setChannel("direct"); setTo(who); }}>Reply</button>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
