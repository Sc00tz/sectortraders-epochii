import { useEffect, useState } from "react";
import type { GameSettings } from "@st/shared";
import { api } from "./api";
import { SettingsForm } from "./SettingsForm";

/** Admin screen for one galaxy: every setting, saved live, plus a manual daily reset. */
export function AdminSettings({ gameId, onBack }: { gameId: number; onBack: () => void }) {
  const [data, setData] = useState<{ name: string; settings: GameSettings } | null>(null);
  const [msg, setMsg] = useState<{ text: string; tone: "good" | "bad" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => { api.adminSettings(gameId).then(setData).catch((e) => setMsg({ text: e.message, tone: "bad" })); }, [gameId]);

  const save = async (patch: Record<string, unknown>) => {
    setBusy(true); setMsg(null);
    try {
      const r = await api.saveAdminSettings(gameId, patch);
      setData((d) => d && { ...d, settings: r.settings });
      setVersion((v) => v + 1); // clears the form's draft
      setMsg({ text: `Saved ${Object.keys(patch).length} change${Object.keys(patch).length === 1 ? "" : "s"}. They're live now, except where a setting says otherwise.`, tone: "good" });
    } catch (e) { setMsg({ text: (e as Error).message, tone: "bad" }); }
    setBusy(false);
  };
  const reset = async () => {
    setBusy(true); setMsg(null);
    try { await api.adminReset(gameId); setMsg({ text: "Daily reset done: turns refilled, ports restocked, planets produced, NPCs topped up.", tone: "good" }); }
    catch (e) { setMsg({ text: (e as Error).message, tone: "bad" }); }
    setBusy(false);
  };

  return (
    <div className="lobby">
      <header className="topbar">
        <button className="brand link" onClick={onBack}>SECTOR TRADERS <em>EPOCH II</em></button>
        <span className="muted">Admin</span>
        <span className="spacer" />
        <button className="link" onClick={onBack}>Back to galaxies</button>
      </header>
      <main className="lobby-main admin-main">
        <h1>{data ? data.name : "Galaxy"} settings</h1>
        <p className="muted">
          Changes apply to this galaxy only and take effect without restarting anything. Settings marked
          "fixed" shaped the galaxy when it was made and can't change now.
        </p>
        <div className="action-row">
          <button disabled={busy} onClick={reset}>Run the daily reset now</button>
          <span className="muted small">Refills everyone's turns, restocks ports, runs planet production and NPC restocking.</span>
        </div>
        {msg && <div className={msg.tone === "bad" ? "error" : "notice"}>{msg.text}</div>}
        {data && <SettingsForm key={version} current={data.settings} mode="edit" busy={busy} onSave={save} saveLabel="Save changes" />}
      </main>
    </div>
  );
}
