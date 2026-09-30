import { useCallback, useEffect, useState } from "react";
import { CORP_EMBLEMS, SHIP_TYPES, type CorpDto, type StateDto } from "@st/shared";
import { api, fmt } from "./api";
import { CorpEmblem } from "./CorpEmblem";

function ago(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 2) return "online";
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
}

/** Found or join a corporation, or run the one you're in. */
export function CorpPanel({ gameId, state, onState }: { gameId: number; state: StateDto; onState: (s: StateDto) => void }) {
  const p = state.player;
  const [corp, setCorp] = useState<CorpDto | null>(null);
  const [msg, setMsg] = useState<{ text: string; tone?: "good" | "bad" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [v, setV] = useState<Record<string, string>>({});
  const [memoEdit, setMemoEdit] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [taken, setTaken] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (!picking) return;
    api.corpEmblemsTaken(gameId).then((r) => setTaken(new Map(r.taken.map((t) => [t.emblem, t.corp])))).catch(() => {});
  }, [gameId, picking]);

  const load = useCallback(() => {
    if (!p.corp) { setCorp(null); return; }
    api.corp(gameId).then(setCorp).catch((e) => setMsg({ text: e.message, tone: "bad" }));
  }, [gameId, p.corp]);
  useEffect(() => { load(); }, [load, state]);

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true); setMsg(null);
    try { const t = await fn(); if (t) setMsg({ text: t, tone: "good" }); setV({}); load(); }
    catch (e) { setMsg({ text: (e as Error).message, tone: "bad" }); }
    finally { setBusy(false); }
  };
  const text = (k: string, placeholder: string, max = 60) => (
    <input value={v[k] ?? ""} placeholder={placeholder} maxLength={max} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
  );
  const num = (k: string) => (
    <input className="num" value={v[k] ?? ""} placeholder="0" onChange={(e) => setV({ ...v, [k]: e.target.value.replace(/\D/g, "") })} />
  );
  const note = msg && <div className={msg.tone === "bad" ? "error" : "muted small"}>{msg.text}</div>;

  if (!p.corp) {
    return (
      <div className="corp">
        <p className="muted small">
          A corporation is a team of up to 5 traders. Members share planets and deployed fighters and mines
          (they never fire on each other), pool credits in a treasury, and talk on a corp channel in the log.
          Its CEO can fly the Magnate, a corporate flagship.
        </p>
        {p.corpInvites.length > 0 && (
          <section>
            <h4>Invitations</h4>
            {p.corpInvites.map((i) => (
              <div key={i.corpId} className="action-row">
                <span><b>{i.name}</b> <span className="muted">from {i.from}</span></span>
                <button className="primary" disabled={busy} onClick={() => run(async () => { onState(await api.corpAccept(gameId, i.corpId)); return `Welcome to ${i.name}.`; })}>Join</button>
                <button disabled={busy} onClick={() => run(async () => { onState(await api.corpDecline(gameId, i.corpId)); })}>Decline</button>
              </div>
            ))}
          </section>
        )}
        <section>
          <h4>Found a corporation</h4>
          <div className="action-row">
            {text("name", "Corporation name", 30)}
            <button className="primary" disabled={busy || (v.name ?? "").trim().length < 3} onClick={() => run(async () => { onState(await api.corpCreate(gameId, v.name ?? "")); })}>Found it</button>
          </div>
          <span className="muted small">You'll be its CEO. It's free.</span>
        </section>
        {note}
      </div>
    );
  }

  if (!corp) return <p className="muted">Loading corporation…</p>;
  const ceo = p.corp.ceo;

  return (
    <div className="corp">
      <div className="corp-head">
        {corp.emblem ? <CorpEmblem id={corp.emblem} size={56} /> : <span className="corp-emblem empty" />}
        <div>
          <h3>{corp.name}</h3>
          <div className="muted small">CEO {corp.ceo} · {corp.members.length} of {corp.maxMembers} members</div>
          {ceo && <button className="link" onClick={() => setPicking(!picking)}>{picking ? "Close" : corp.emblem ? "Change emblem" : "Choose an emblem"}</button>}
        </div>
      </div>
      {ceo && picking && (
        <section>
          <div className="emblem-grid">
            {CORP_EMBLEMS.map((e) => {
              const other = taken.get(e.id);
              const flying = other && other !== corp.name ? other : null;
              return (
                <button key={e.id} className={`emblem-pick${corp.emblem === e.id ? " active" : ""}`} disabled={busy || !!flying}
                  title={flying ? `${flying} flies this one` : e.name}
                  onClick={() => run(async () => { setCorp(await api.corpEmblem(gameId, e.id)); setPicking(false); onState(await api.state(gameId)); })}>
                  <CorpEmblem id={e.id} size={40} />
                  <span className="small">{e.name}</span>
                </button>
              );
            })}
          </div>
          {corp.emblem && <button className="link" disabled={busy} onClick={() => run(async () => { setCorp(await api.corpEmblem(gameId, null)); setPicking(false); onState(await api.state(gameId)); })}>Take the emblem down</button>}
          <div className="muted small">Your emblem shows beside your members' names and your planets. Each emblem belongs to one corporation at a time.</div>
        </section>
      )}

      <section>
        <h4>Treasury <span className="muted small">{fmt(corp.credits)} credits</span></h4>
        <div className="action-row">
          {num("dep")}
          <button disabled={busy} onClick={() => run(async () => { onState(await api.corpDeposit(gameId, Number(v.dep) || 0)); })}>Deposit</button>
          {ceo && <button disabled={busy} onClick={() => run(async () => { onState(await api.corpWithdraw(gameId, Number(v.dep) || 0)); })}>Withdraw</button>}
        </div>
        {!ceo && <span className="muted small">Anyone can deposit; only the CEO withdraws.</span>}
      </section>

      <section>
        <h4>Memo</h4>
        {memoEdit != null ? (
          <>
            <textarea rows={4} maxLength={1000} value={memoEdit} onChange={(e) => setMemoEdit(e.target.value)} />
            <div className="action-row">
              <button className="primary" disabled={busy} onClick={() => run(async () => { setCorp(await api.corpMemo(gameId, memoEdit)); setMemoEdit(null); })}>Save</button>
              <button disabled={busy} onClick={() => setMemoEdit(null)}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            <div className="memo">{corp.memo || <span className="muted">No memo yet.</span>}</div>
            {ceo && <button className="link" onClick={() => setMemoEdit(corp.memo)}>Edit memo</button>}
          </>
        )}
      </section>

      <section>
        <h4>Corp channel</h4>
        <div className="action-row">
          {text("say", "Message your corporation", 500)}
          <button disabled={busy || !(v.say ?? "").trim()} onClick={() => run(async () => { await api.corpSay(gameId, v.say ?? ""); return "Sent. It shows up in everyone's log."; })}>Send</button>
        </div>
      </section>

      <section>
        <h4>Members</h4>
        <table className="slots">
          <thead><tr><th>Trader</th><th>Ship</th><th>Sector</th><th>Seen</th>{ceo && <th />}</tr></thead>
          <tbody>
            {corp.members.map((m) => (
              <tr key={m.id}>
                <td>{m.alias}{m.ceo && <span className="badge fed">CEO</span>}</td>
                <td>{SHIP_TYPES[m.ship]?.name ?? m.ship}</td>
                <td>{m.sector}</td>
                <td className="muted">{m.id === p.id ? "you" : ago(m.lastSeen)}</td>
                {ceo && <td>{!m.ceo && <>
                  <button className="link" disabled={busy} onClick={() => run(async () => { setCorp(await api.corpHandOver(gameId, m.id)); onState(await api.state(gameId)); })}>Make CEO</button>
                  {" "}<button className="link danger-link" disabled={busy} onClick={() => run(async () => { setCorp(await api.corpExpel(gameId, m.id)); })}>Expel</button>
                </>}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {ceo && corp.members.length < corp.maxMembers && (
          <div className="action-row">
            {text("inv", "Trader name", 24)}
            <button disabled={busy || !(v.inv ?? "").trim()} onClick={() => run(async () => { setCorp(await api.corpInvite(gameId, v.inv ?? "")); return "Invitation sent."; })}>Invite</button>
          </div>
        )}
        {ceo && corp.invited.length > 0 && (
          <div className="muted small">
            Waiting on: {corp.invited.map((i, n) => (
              <span key={i.id}>{n > 0 && ", "}{i.alias} <button className="link" disabled={busy} onClick={() => run(async () => { setCorp(await api.corpUninvite(gameId, i.id)); })}>cancel</button></span>
            ))}
          </div>
        )}
      </section>

      <section>
        {ceo ? (
          <div className="action-row">
            <button className="danger" disabled={busy || v.confirm !== "disband"} onClick={() => run(async () => { onState(await api.corpDisband(gameId)); })}>Disband</button>
            {text("confirm", 'Type "disband" to confirm', 10)}
            <span className="muted small">Members go independent and the treasury comes to you. To leave instead, make someone else CEO first.</span>
          </div>
        ) : (
          <button className="danger" disabled={busy} onClick={() => run(async () => { onState(await api.corpLeave(gameId)); })}>Leave {corp.name}</button>
        )}
      </section>
      {note}
    </div>
  );
}
