import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { PLACE, SHIP_TYPES, rankTitle, type ActionResultDto, type MeDto, type MessageDto, type SectorEventDto, type StateDto } from "@st/shared";
import { api, fmt } from "./api";
import { SectorScene } from "./SectorScene";
import { GalaxyMap } from "./GalaxyMap";
import { PortPanel } from "./PortPanel";
import { SectorActions } from "./SectorActions";
import { ShipPanel } from "./ShipPanel";
import { PlanetPanel } from "./PlanetPanel";
import { CorpPanel } from "./CorpPanel";
import { CommsPanel } from "./CommsPanel";

export function Game({ gameId, me, onExit, onLogout }: { gameId: number; me: MeDto; onExit: () => void; onLogout: () => void }) {
  const [state, setState] = useState<StateDto | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<"sector" | "map">("sector");
  const [tab, setTab] = useState<"port" | "planet" | "ship" | "corp" | "log">("port");
  const [log, setLog] = useState<MessageDto[]>([]);
  const [away, setAway] = useState<number | null>(null); // unread count when you arrived
  const [report, setReport] = useState<string[]>([]);
  const [target, setTarget] = useState("");
  const [route, setRoute] = useState<{ to: number; path: number[]; turns: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const tabRef = useRef(tab);
  tabRef.current = tab;

  const refresh = useCallback(() => api.state(gameId).then(setState).catch((e) => setError(e.message)), [gameId]);
  const loadLog = useCallback(() => api.messages(gameId).then(setLog).catch(() => {}), [gameId]);

  useEffect(() => {
    api.state(gameId).then((s) => { setState(s); if (s.player.unread > 0) setAway(s.player.unread); }).catch((e) => setError(e.message));
    loadLog();
  }, [gameId, loadLog]);

  // Live updates: this game's rooms, re-joined after every move (the sector room changes).
  useEffect(() => {
    const s = io({ path: "/socket.io", withCredentials: true });
    socketRef.current = s;
    s.on("connect", () => s.emit("watch", { gameId }));
    s.on("event", (_e: SectorEventDto) => { refresh(); });
    s.on("message", () => {
      loadLog();
      if (tabRef.current === "log") api.markRead(gameId).catch(() => {});
      refresh();
    });
    return () => { s.disconnect(); socketRef.current = null; };
  }, [gameId, refresh, loadLog]);
  useEffect(() => { socketRef.current?.emit("watch", { gameId }); }, [gameId, state?.player.sector]);

  // Opening the log marks everything read.
  useEffect(() => {
    if (tab !== "log" || !state?.player.unread) return;
    api.markRead(gameId).then(() => { setAway(null); refresh(); }).catch(() => {});
  }, [tab, state?.player.unread, gameId, refresh]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const onResult = (r: ActionResultDto) => { setState(r.state); setReport(r.report); };

  const warp = (to: number) => act(async () => {
    const r = await api.move(gameId, to);
    onResult(r);
    setRoute(null);
  });

  const plot = (to: number) => act(async () => {
    const c = await api.course(gameId, to);
    setRoute({ to, ...c });
  });

  const fly = () => route && act(async () => {
    const r = await api.autopilot(gameId, route.to);
    setState(r.state);
    setReport([
      r.stoppedEarly ? `Autopilot stopped after ${r.moved} of ${r.planned} jumps.` : `Autopilot arrived at sector ${route.to} (${r.moved} jumps).`,
      ...r.report,
    ]);
    setRoute(null);
  });

  if (!state) {
    return <div className="center">{error ? <div className="error">{error} <button className="link" onClick={onExit}>Back</button></div> : <span className="muted">Loading…</span>}</div>;
  }

  const p = state.player;
  const ship = SHIP_TYPES[p.ship]!;
  const used = p.cargo.ore + p.cargo.org + p.cargo.equ + p.colonists;
  const sec = state.sector;

  return (
    <div className="game">
      <header className="topbar">
        <button className="brand link" onClick={onExit} title="Back to galaxies">SECTOR TRADERS <em>EPOCH II</em></button>
        <span className="muted">{state.game.name}</span>
        <span className="spacer" />
        <Stat label={rankTitle(p.experience, p.alignment)} value={p.alias} />
        <Stat label="Sector" value={fmt(p.sector)} />
        <Stat label="Turns" value={`${fmt(p.turns)} / ${fmt(state.game.turnsPerDay)}`} warn={p.turns < ship.turnsPerWarp} />
        <Stat label="Credits" value={fmt(p.credits)} />
        <Stat label="Holds" value={`${used} / ${p.holds}`} />
        <Stat label="Fighters" value={fmt(p.fighters)} />
        <Stat label="Shields" value={fmt(p.shields)} />
        {p.cloaked && <span className="badge fed" title="Hidden until you next act">Cloaked</span>}
        <span className="spacer small" />
        <a className="link" href="#guide" target="_blank" rel="noreferrer">How to play</a>
        <button className="link" onClick={onLogout}>Sign out</button>
      </header>

      {away != null && (
        <div className="away">
          While you were away: {away} new message{away > 1 ? "s" : ""} in your log.
          <button className="link" onClick={() => setTab("log")}>Read them</button>
          <button className="link" onClick={() => setAway(null)}>Dismiss</button>
        </div>
      )}

      <div className="game-body">
        <section className="main-col">
          <div className="view-tabs">
            <button className={view === "sector" ? "active" : ""} onClick={() => setView("sector")}>Sector view</button>
            <button className={view === "map" ? "active" : ""} onClick={() => setView("map")}>Galaxy map</button>
          </div>
          <div className="viewport panel">
            {view === "sector"
              ? <SectorScene sector={sec} shipSprite={ship.sprite} />
              : <GalaxyMap gameId={gameId} current={p.sector} route={route?.path ?? null} onPick={(id) => { setTarget(String(id)); plot(id); }} />}
          </div>

          <div className="panel nav">
            <div className="nav-head">
              <h2>Sector {fmt(sec.id)} {sec.fedspace && <span className="badge fed">{PLACE.coreShort}</span>}</h2>
              <span className="muted">{sec.port ? (sec.port.cls === 0 || sec.port.cls === 9 ? sec.port.name : `${sec.port.name} · ${sec.port.pattern}`) : "No port"}</span>
            </div>
            {report.length > 0 && (
              <div className="report">
                {report.map((r, i) => <div key={i}>{r}</div>)}
                <button className="link" onClick={() => setReport([])}>OK</button>
              </div>
            )}
            <div className="warps">
              <span className="label">Warp to</span>
              {sec.warps.map((w) => (
                <button key={w} disabled={busy || (!!sec.blocked && w !== sec.blocked.backTo)} onClick={() => warp(w)}>{w}</button>
              ))}
              <span className="muted small">({ship.turnsPerWarp} turns per jump)</span>
            </div>
            <form className="course" onSubmit={(e) => { e.preventDefault(); const n = Number(target); if (n) plot(n); }}>
              <span className="label">Plot course</span>
              <input value={target} onChange={(e) => setTarget(e.target.value.replace(/\D/g, ""))} placeholder="Sector #" inputMode="numeric" />
              <button disabled={busy || !target}>Plot</button>
              {!!p.gear.transwarp && ship.transwarp && (
                <button type="button" disabled={busy || !target} title="1 turn plus Fuel Ore for each sector of the shortest route"
                  onClick={() => act(async () => { const r = await api.transwarp(gameId, Number(target)); onResult(r); setRoute(null); })}>TransWarp</button>
              )}
              {route && (
                <>
                  <span className="route">{route.path.length ? `${route.path.length} jumps · ${route.turns} turns: ${route.path.join(" › ")}` : "You're already there."}</span>
                  {route.path.length > 0 && <button className="primary" disabled={busy} onClick={fly} type="button">Engage autopilot</button>}
                </>
              )}
            </form>
            <SectorActions key={sec.id} gameId={gameId} state={state} onState={setState} onResult={onResult} onRetreat={warp} onLanded={() => setTab("planet")} />
            {error && <div className="error">{error}</div>}
          </div>
        </section>

        <aside className="side-col">
          <div className="view-tabs">
            <button className={tab === "port" ? "active" : ""} onClick={() => setTab("port")}>Port</button>
            {p.landedPlanetId && <button className={tab === "planet" ? "active" : ""} onClick={() => setTab("planet")}>Planet</button>}
            <button className={tab === "ship" ? "active" : ""} onClick={() => setTab("ship")}>Ship</button>
            <button className={tab === "corp" ? "active" : ""} onClick={() => setTab("corp")}>Corp{p.corpInvites.length ? <span className="count">{p.corpInvites.length}</span> : null}</button>
            <button className={tab === "log" ? "active" : ""} onClick={() => setTab("log")}>Log{p.unread ? <span className="count">{p.unread}</span> : null}</button>
          </div>
          <div className="panel side-panel">
            {tab === "port" && <PortPanel gameId={gameId} state={state} onState={setState} />}
            {tab === "planet" && (p.landedPlanetId
              ? <PlanetPanel gameId={gameId} state={state} onState={setState} onReport={setReport} />
              : <p className="muted">You're not on a planet. Land on one from the sector panel.</p>)}
            {tab === "ship" && <ShipPanel gameId={gameId} state={state} me={me} onAdminReset={() => act(async () => { await api.adminReset(gameId); })} />}
            {tab === "corp" && <CorpPanel gameId={gameId} state={state} onState={setState} />}
            {tab === "log" && <CommsPanel gameId={gameId} state={state} log={log} onSent={() => { loadLog(); refresh(); }} />}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return <span className={`stat${warn ? " warn" : ""}`}><small>{label}</small>{value}</span>;
}
