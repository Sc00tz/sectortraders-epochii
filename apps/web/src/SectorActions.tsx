import { useState } from "react";
import { PLACE, FACTIONS, PLANET_CLASSES, SHIP_TYPES, type ActionResultDto, type FighterMode, type PlanetClassId, type StateDto } from "@st/shared";
import { api, fmt } from "./api";
import { CorpEmblem } from "./CorpEmblem";

const MODES: { id: FighterMode; label: string; hint: string }[] = [
  { id: "defensive", label: "Defensive", hint: "block anyone passing through" },
  { id: "toll", label: "Toll", hint: "let traders pass for a fee" },
  { id: "offensive", label: "Offensive", hint: "attack anyone who enters" },
];

/** Blockades, deployed fighters, mines, and other traders in the current sector. */
export function SectorActions({ gameId, state, onState, onResult, onRetreat, onLanded }: {
  gameId: number; state: StateDto;
  onState: (s: StateDto) => void;
  onResult: (r: ActionResultDto) => void;
  onRetreat: (to: number) => void;
  onLanded: () => void;
}) {
  const p = state.player;
  const sec = state.sector;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [count, setCount] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<FighterMode>(sec.fighters?.mine ? sec.fighters.mode : "defensive");
  const num = (k: string, dflt: number) => Number(count[k] ?? dflt) || 0;
  const field = (k: string, dflt: number) => (
    <input className="num" value={count[k] ?? String(dflt)} onChange={(e) => setCount({ ...count, [k]: e.target.value.replace(/\D/g, "") })} />
  );

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr("");
    try { await fn(); setCount({}); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const stack = sec.fighters;
  const g = p.gear;
  const hasGear = !!(g.density || g.holo || g.probe || g.photon || g.disruptor || g.cloak || g.beacon);
  const scanPlanet = (id: number) => run(async () => {
    const d = await api.planetScan(gameId, id);
    onResult({ state, report: [
      `Planet scan: ${d.name} (Class ${d.cls})${d.owner ? `, owned by ${d.owner}` : ", unclaimed"}.`,
      `Defenses: ${fmt(d.fighters)} fighters, ${fmt(d.shields)} shields${d.citadel ? `, citadel level ${d.citadel}` : ", no citadel"}.`,
      `Colonists: ${fmt(d.colonists.ore + d.colonists.org + d.colonists.equ)}. Stock: ${fmt(d.stock.ore)} Fuel Ore, ${fmt(d.stock.org)} Organics, ${fmt(d.stock.equ)} Equipment.`,
      ...(d.citadel ? [`Treasury: ${fmt(d.credits)} credits. Military reaction ${d.militaryPct}%, Q-cannon ${d.qSectorPct}% sector / ${d.qAtmoPct}% atmosphere.`] : []),
    ] });
  });
  const canDeploy = !sec.fedspace && p.ship !== "escape_pod" && (!stack || stack.mine);

  return (
    <div className="sector-actions">
      {sec.blocked && (
        <div className="alert bad">
          <span>{sec.blocked.reason}</span>
          {sec.blocked.tollDue != null && (
            <button disabled={busy || p.credits < sec.blocked.tollDue} onClick={() => run(async () => onState(await api.payToll(gameId)))}>
              Pay {fmt(sec.blocked.tollDue)}
            </button>
          )}
          {sec.blocked.backTo && <button disabled={busy} onClick={() => onRetreat(sec.blocked!.backTo!)}>Retreat to {sec.blocked.backTo}</button>}
        </div>
      )}

      {stack && !stack.mine && (
        <div className="action-row">
          <span className="label">Hostile</span>
          <span>{fmt(stack.count)} {stack.mode} fighters ({stack.owner})</span>
          {p.fighters > 0 && <>
            {field("hit", p.fighters)}
            <button className="danger" disabled={busy} onClick={() => run(async () => onResult(await api.attackFighters(gameId, num("hit", p.fighters))))}>Attack them (1 turn)</button>
          </>}
        </div>
      )}

      {stack?.mine && (
        <div className="action-row">
          <span className="label">{stack.corp ? "Corp fighters" : "Your fighters"}</span>
          <span>{fmt(stack.count)} here, {stack.mode}{stack.corp && <span className="muted"> · {stack.owner}'s</span>}</span>
          {field("ret", stack.count)}
          <button disabled={busy} onClick={() => run(async () => onState(await api.retrieve(gameId, num("ret", stack.count))))}>Recall</button>
        </div>
      )}

      {canDeploy && p.fighters > 0 && (
        <div className="action-row">
          <span className="label">Deploy</span>
          {field("dep", Math.floor(p.fighters / 2))}
          <span className="muted small">fighters as</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as FighterMode)}>
            {MODES.map((m) => <option key={m.id} value={m.id}>{m.label}: {m.hint}</option>)}
          </select>
          <button disabled={busy} onClick={() => run(async () => onState(await api.deploy(gameId, num("dep", Math.floor(p.fighters / 2)), mode)))}>Deploy</button>
        </div>
      )}

      {!sec.fedspace && (p.armids > 0 || p.limpets > 0) && (
        <div className="action-row">
          <span className="label">Mines</span>
          {p.armids > 0 && <>{field("arm", p.armids)}<button disabled={busy} onClick={() => run(async () => onState(await api.layMines(gameId, "armid", num("arm", p.armids))))}>Lay burst mines</button></>}
          {p.limpets > 0 && <>{field("lim", p.limpets)}<button disabled={busy} onClick={() => run(async () => onState(await api.layMines(gameId, "limpet", num("lim", p.limpets))))}>Lay limpets</button></>}
        </div>
      )}
      {(sec.myMines.armid > 0 || sec.myMines.limpet > 0) && (
        <div className="muted small">Your mines here: {sec.myMines.armid} burst, {sec.myMines.limpet} limpet.</div>
      )}
      {sec.fedspace && <div className="muted small">{PLACE.core}: no fighters or mines may be deployed here.</div>}

      {sec.homeColonists != null && (
        <div className="action-row">
          <span className="label">{PLACE.homeWorld}</span>
          <span>{fmt(sec.homeColonists)} colonists waiting to emigrate</span>
          {p.ship !== "escape_pod" && <>
            {field("colo", Math.max(0, Math.min(sec.homeColonists, p.holds - p.cargo.ore - p.cargo.org - p.cargo.equ - p.colonists)))}
            <button disabled={busy} onClick={() => run(async () => onState(await api.loadColonists(gameId, num("colo", Math.min(sec.homeColonists!, p.holds - p.cargo.ore - p.cargo.org - p.cargo.equ - p.colonists)))))}>Take aboard</button>
          </>}
        </div>
      )}

      {sec.planets.map((pl) => {
        const c = PLANET_CLASSES[pl.cls as PlanetClassId];
        const landed = p.landedPlanetId === pl.id;
        return (
          <div key={pl.id} className="action-row">
            <span className="label">Planet</span>
            <span>{pl.ownerEmblem && <CorpEmblem id={pl.ownerEmblem} size={16} />} {pl.name} <span className="muted">· Class {pl.cls} {c?.name} · {pl.owner ? (pl.corp ? `corp (${pl.owner})` : pl.mine ? "yours" : pl.owner) : "unclaimed"}{pl.citadel ? ` · citadel ${pl.citadel}` : ""}{pl.interdictor ? " · interdictor" : ""}</span></span>
            {!!g.planetScanner && !pl.mine && <button disabled={busy} onClick={() => scanPlanet(pl.id)}>Scan</button>}
            {landed ? <span className="badge fed">Landed</span>
              : pl.mine || !pl.owner ? <button disabled={busy} onClick={() => run(async () => { onState(await api.land(gameId, pl.id)); onLanded(); })}>{pl.owner ? "Land (1 turn)" : "Land and claim (1 turn)"}</button>
              : p.fighters > 0 && <>
                {field(`pl${pl.id}`, p.fighters)}
                <button className="danger" disabled={busy} onClick={() => run(async () => { const r = await api.attackPlanet(gameId, pl.id, num(`pl${pl.id}`, p.fighters)); onResult(r); if (r.state.player.landedPlanetId) onLanded(); })}>Attack (1 turn)</button>
                <button disabled={busy} title="Only works if it has no fighters or shields" onClick={() => run(async () => { onState(await api.land(gameId, pl.id)); onLanded(); })}>Land</button>
              </>}
          </div>
        );
      })}

      {sec.photonUntil && (
        <div className="alert">A photon wave is up until {new Date(sec.photonUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}: fighters and weak planet defenses here are out of action.</div>
      )}

      {sec.beacon && (
        <div className="action-row">
          <span className="label">Beacon</span>
          <span>"{sec.beacon.message}" <span className="muted">· {sec.beacon.owner}</span></span>
          {sec.beacon.mine && <button className="link" disabled={busy} onClick={() => run(async () => onState(await api.removeBeacon(gameId)))}>Take it down</button>}
        </div>
      )}

      {hasGear && (
        <div className="gear-actions">
          <span className="label">Equipment</span>
          <div className="gear-buttons">
            {!!g.density && <button disabled={busy} onClick={() => run(async () => onResult(await api.densityScan(gameId)))}>Density scan</button>}
            {!!g.holo && <button disabled={busy} onClick={() => run(async () => onResult(await api.holoScan(gameId)))}>Holo scan (1 turn)</button>}
            {!!g.cloak && !sec.fedspace && <button disabled={busy} title="Hides your ship until you next act" onClick={() => run(async () => onState(await api.cloak(gameId)))}>Cloak ({g.cloak})</button>}
          </div>
          {!!g.probe && (
            <div className="action-row">
              <input className="num" value={count.probe ?? ""} placeholder="Sector" onChange={(e) => setCount({ ...count, probe: e.target.value.replace(/\D/g, "") })} />
              <button disabled={busy || !count.probe} onClick={() => run(async () => onResult(await api.probe(gameId, Number(count.probe))))}>Launch probe ({g.probe})</button>
            </div>
          )}
          {(!!g.photon || !!g.disruptor) && (
            <div className="action-row">
              <select value={count.aim ?? String(sec.warps[0] ?? "")} onChange={(e) => setCount({ ...count, aim: e.target.value })}>
                {sec.warps.map((w) => <option key={w} value={w}>Sector {w}</option>)}
                {!!g.disruptor && <option value={sec.id}>Here ({sec.id}), disruptor only</option>}
              </select>
              {!!g.photon && !sec.fedspace && <button className="danger" disabled={busy || Number(count.aim ?? sec.warps[0]) === sec.id}
                onClick={() => run(async () => onResult(await api.photon(gameId, Number(count.aim ?? sec.warps[0]))))}>Fire photon ({g.photon})</button>}
              {!!g.disruptor && <button disabled={busy} onClick={() => run(async () => onResult(await api.disruptor(gameId, Number(count.aim ?? sec.warps[0]))))}>Fire disruptor ({g.disruptor})</button>}
            </div>
          )}
          {!!g.beacon && !sec.fedspace && (
            <div className="action-row">
              <input value={count.beacon ?? ""} maxLength={80} placeholder="Beacon message" onChange={(e) => setCount({ ...count, beacon: e.target.value })} />
              <button disabled={busy || !(count.beacon ?? "").trim()} onClick={() => run(async () => onState(await api.beacon(gameId, count.beacon ?? "")))}>Place beacon ({g.beacon})</button>
            </div>
          )}
        </div>
      )}

      {p.genesis > 0 && !sec.fedspace && (
        <div className="action-row">
          <span className="label">Genesis</span>
          <input value={count.gname ?? ""} placeholder="Planet name (optional)" onChange={(e) => setCount({ ...count, gname: e.target.value })} />
          <button className="primary" disabled={busy} onClick={() => run(async () => { onResult(await api.genesis(gameId, count.gname ?? "")); })}>Launch torpedo (1 turn)</button>
          <span className="muted small">{p.genesis} aboard</span>
        </div>
      )}

      {sec.traders.length > 0 && (
        <div className="traders">
          {sec.traders.map((t) => {
            const f = t.npc ? FACTIONS[t.npc.faction] : null;
            const canHit = !t.protected && !t.corpmate && (t.npc?.attackable ?? true) && p.fighters > 0;
            return (
              <div key={t.id} className={`action-row trader${t.npc ? ` npc ${t.npc.faction}` : ""}`}>
                {t.npc?.portrait
                  ? <img className="portrait" src={`/sprites/${t.npc.portrait}.png`} alt="" />
                  : <span className="label">{f ? <img className="emblem" src={`/sprites/${f.emblem}.png`} alt="" title={f.name} /> : "Trader"}</span>}
                <span className="who">
                  <span>{t.rank && <span className="muted">{t.rank} </span>}{t.alias} <span className="muted">· {SHIP_TYPES[t.ship]?.name ?? t.ship}</span>{t.corp && <span className="corp-tag"> {t.corpEmblem && <CorpEmblem id={t.corpEmblem} size={16} title={t.corp} />}[{t.corp}]</span>}</span>
                  {f && <span className="small">
                    <span className={`faction ${t.npc!.faction}`} title={f.blurb}>{f.name}</span>
                    {t.npc!.hostile && <span className="badge hostile">Hostile</span>}
                    {t.npc!.note && <span className="muted"> · {t.npc!.note}</span>}
                  </span>}
                </span>
                {t.corpmate ? <span className="badge corp">Corpmate</span> : t.protected ? <span className="badge fed">Authority protected</span> : canHit && <>
                  {field(`t${t.id}`, p.fighters)}
                  <button className="danger" disabled={busy} onClick={() => run(async () => onResult(await api.attack(gameId, t.id, num(`t${t.id}`, p.fighters))))}>Attack (1 turn)</button>
                </>}
              </div>
            );
          })}
        </div>
      )}
      {err && <div className="error">{err}</div>}
    </div>
  );
}
