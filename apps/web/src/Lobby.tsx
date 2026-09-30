import { useEffect, useState } from "react";
import { DEFAULT_SETTINGS, type GameSummaryDto, type MeDto } from "@st/shared";
import { api, fmt } from "./api";
import { SettingsForm } from "./SettingsForm";

export function Lobby({ me, onEnter, onAdmin, onLogout }: { me: MeDto; onEnter: (id: number) => void; onAdmin: (id: number) => void; onLogout: () => void }) {
  const [games, setGames] = useState<GameSummaryDto[] | null>(null);
  const [error, setError] = useState("");
  const [aliases, setAliases] = useState<Record<number, string>>({});
  const [newName, setNewName] = useState("");
  const [newSectors, setNewSectors] = useState(1000);
  const [busy, setBusy] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [leaving, setLeaving] = useState<number | null>(null); // game whose "leave for good" panel is open
  const [confirm, setConfirm] = useState("");

  const load = () => api.games().then(setGames).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const join = async (g: GameSummaryDto) => {
    setError("");
    try { await api.join(g.id, aliases[g.id] ?? ""); onEnter(g.id); } catch (e) { setError((e as Error).message); }
  };
  const leave = async (g: GameSummaryDto) => {
    setBusy(true); setError("");
    try { await api.leaveGame(g.id, confirm); setLeaving(null); setConfirm(""); await load(); }
    catch (e) { setError((e as Error).message); }
    setBusy(false);
  };
  const create = async (settings: Record<string, unknown>) => {
    if (newName.trim().length < 3) { setError("Give the galaxy a name first (3 or more characters)"); return; }
    setBusy(true); setError("");
    try { await api.createGame(newName, settings); setNewName(""); setAdvanced(false); await load(); } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };

  return (
    <div className="lobby">
      <header className="topbar">
        <span className="brand">SECTOR TRADERS <em>EPOCH II</em></span>
        <span className="spacer" />
        <span className="muted">{me.username}{me.isAdmin ? " · admin" : ""}</span>
        <a className="link" href="#guide">How to play</a>
        <button className="link" onClick={onLogout}>Sign out</button>
      </header>
      <main className="lobby-main">
        <h1>Galaxies</h1>
        {error && <div className="error">{error}</div>}
        {!games ? <p className="muted">Loading…</p> : games.length === 0 ? (
          <p className="muted">No galaxies yet.{me.isAdmin ? " Create the first one below." : " Ask the admin to create one."}</p>
        ) : (
          <div className="game-list">
            {games.map((g) => (
              <div key={g.id} className="panel game-card">
                <div>
                  <h3>{g.name}</h3>
                  <div className="muted">{fmt(g.sectors)} sectors · {g.players} trader{g.players === 1 ? "" : "s"}</div>
                </div>
                {me.isAdmin && <button className="link" onClick={() => onAdmin(g.id)}>Settings</button>}
                {g.joined ? (
                  <div className="join-row">
                    <button className="primary" onClick={() => onEnter(g.id)}>Play as {g.alias}</button>
                    <button className="link" onClick={() => { setLeaving(leaving === g.id ? null : g.id); setConfirm(""); setError(""); }}>Leave galaxy</button>
                  </div>
                ) : (
                  <div className="join-row">
                    <input placeholder="Trader name" value={aliases[g.id] ?? ""} onChange={(e) => setAliases({ ...aliases, [g.id]: e.target.value })} />
                    <button className="primary" onClick={() => join(g)}>Join</button>
                  </div>
                )}
                {leaving === g.id && (
                  <div className="leave-row">
                    <div className="muted small">
                      This deletes {g.alias} from {g.name} for good: the ship, credits, holds, fighters, mines, beacons and bookmarks all go.
                      Planets pass to a corpmate if you have one, or become unclaimed. Your account and your other galaxies are untouched,
                      and you can join {g.name} again later as a brand new trader.
                    </div>
                    <div className="join-row">
                      <input placeholder={`Type ${g.alias} to confirm`} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                      <button className="danger" disabled={busy || confirm.trim().toLowerCase() !== (g.alias ?? "").trim().toLowerCase()} onClick={() => leave(g)}>
                        Leave for good
                      </button>
                      <button className="link" onClick={() => { setLeaving(null); setConfirm(""); }}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {me.isAdmin && (
          <div className="panel create-game">
            <h3>Create a galaxy</h3>
            <div className="join-row">
              <input placeholder="Galaxy name" value={newName} onChange={(e) => setNewName(e.target.value)} />
              {!advanced && <>
                <label className="inline">Sectors
                  <select value={newSectors} onChange={(e) => setNewSectors(Number(e.target.value))}>
                    {[500, 1000, 2000, 5000, 10000].map((n) => <option key={n} value={n}>{fmt(n)}</option>)}
                  </select>
                </label>
                <button className="primary" disabled={busy || newName.trim().length < 3} onClick={() => create({ sectors: newSectors })}>{busy ? "Running the Big Bang…" : "Create"}</button>
              </>}
              <button className="link" onClick={() => setAdvanced(!advanced)}>{advanced ? "Fewer options" : "All settings…"}</button>
            </div>
            {advanced && (
              <SettingsForm current={DEFAULT_SETTINGS} mode="create" busy={busy} onSave={create} saveLabel={busy ? "Running the Big Bang…" : "Create galaxy"} />
            )}
          </div>
        )}
      </main>
    </div>
  );
}
