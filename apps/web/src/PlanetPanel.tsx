import { useCallback, useEffect, useState } from "react";
import { CITADEL_LEVELS, PLANET_CLASSES, type CorpPlanetDto, type PlanetClassId, type PlanetDto, type StateDto } from "@st/shared";
import { api, fmt } from "./api";
import { Icon } from "./Icon";

type Group = "ore" | "org" | "equ";
const GROUP_LABEL: Record<Group, string> = { ore: "Fuel Ore", org: "Organics", equ: "Equipment" };

/** Everything you can do while landed on your own planet. */
export function PlanetPanel({ gameId, state, onState, onReport }: {
  gameId: number; state: StateDto; onState: (s: StateDto) => void; onReport: (lines: string[]) => void;
}) {
  const p = state.player;
  const [pl, setPl] = useState<PlanetDto | null>(null);
  const [msg, setMsg] = useState<{ text: string; tone?: "good" | "bad" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [v, setV] = useState<Record<string, string>>({});
  const [split, setSplit] = useState<Record<Group, string> | null>(null);
  const [scan, setScan] = useState<CorpPlanetDto[] | null>(null);

  const load = useCallback(() => api.planet(gameId).then((d) => { setPl(d); setSplit(null); }).catch((e) => setMsg({ text: e.message, tone: "bad" })), [gameId]);
  useEffect(() => { load(); }, [load, state]);

  if (!pl) return <p className="muted">Loading planet…</p>;
  const cls = PLANET_CLASSES[pl.cls as PlanetClassId];
  const totalCol = pl.colonists.ore + pl.colonists.org + pl.colonists.equ;
  const free = p.holds - p.cargo.ore - p.cargo.org - p.cargo.equ - p.colonists;
  const num = (k: string) => Number(v[k] ?? "") || 0;
  const input = (k: string, placeholder = "0") => (
    <input className="num" value={v[k] ?? ""} placeholder={placeholder} onChange={(e) => setV({ ...v, [k]: e.target.value.replace(/[^\d]/g, "") })} />
  );

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    try { const t = await fn(); if (t) setMsg({ text: t, tone: "good" }); setV({}); await load(); }
    catch (e) { setMsg({ text: (e as Error).message, tone: "bad" }); }
    finally { setBusy(false); }
  };
  const xfer = (what: string, amount: number, group?: Group) => run(async () => { onState(await api.planetTransfer(gameId, what, amount, group)); });

  const building = pl.building;
  const next = pl.nextLevel;

  return (
    <div className="planet">
      <div className="planet-hero">
        <div className={`planet-art${pl.citadel > 0 ? " fortified" : ""}`}>
          <img src={`/sprites/${cls.sprite}.png`} alt="" />
          {pl.citadel > 0 && <img className="citadel-art" src={`/sprites/citadel_${pl.citadel}.png`} alt={`Citadel level ${pl.citadel}`} />}
        </div>
        <div>
          <h3>{pl.name}</h3>
          <div className="muted small">Class {pl.cls} · {cls.name} · sector {pl.sector}</div>
          <div className="muted small">Citadel: {pl.citadel ? `level ${pl.citadel}, ${CITADEL_LEVELS[pl.citadel - 1]!.name}` : "none"}</div>
          <button className="link" disabled={busy} onClick={() => run(async () => { onState(await api.liftOff(gameId)); })}>Lift off</button>
          {!!p.gear.detonator && (
            <button className="link danger-link" disabled={busy} title="Destroys this planet. Costs alignment."
              onClick={() => { if (window.confirm(`Destroy ${pl.name} for good?`)) run(async () => { const r = await api.detonate(gameId); onReport(r.report); onState(r.state); }); }}>
              Atomic detonator ({p.gear.detonator})
            </button>
          )}
        </div>
      </div>

      <section>
        <h4 className="with-icon"><Icon item="colonists" />Colonists <span className="muted small">{fmt(totalCol)} of {fmt(pl.maxColonists)} (output peaks at {fmt(pl.maxColonists / 2)})</span></h4>
        <table className="slots">
          <thead><tr><th>Job</th><th>Colonists</th><th>Makes / day</th></tr></thead>
          <tbody>
            {(Object.keys(GROUP_LABEL) as Group[]).map((g) => (
              <tr key={g}>
                <td><span className="with-icon"><Icon item={g} />{GROUP_LABEL[g]}</span></td>
                <td>{split
                  ? <input className="num" value={split[g]} onChange={(e) => setSplit({ ...split, [g]: e.target.value.replace(/\D/g, "") })} />
                  : fmt(pl.colonists[g])}</td>
                <td>{cls.ratio[g] ? fmt(pl.production[g]) : <span className="muted">can't</span>}</td>
              </tr>
            ))}
            <tr><td><span className="with-icon"><Icon item="fighters" />Fighters</span></td><td /><td>{fmt(pl.production.fighters)}</td></tr>
          </tbody>
        </table>
        <div className="action-row">
          {split ? <>
            <span className="muted small">Total must stay {fmt(totalCol)}</span>
            <button disabled={busy} onClick={() => run(async () => { await api.planetAssign(gameId, { ore: Number(split.ore) || 0, org: Number(split.org) || 0, equ: Number(split.equ) || 0 }); return "Colonists reassigned."; })}>Save</button>
            <button className="link" onClick={() => setSplit(null)}>Cancel</button>
          </> : <button disabled={busy || !totalCol} onClick={() => setSplit({ ore: String(pl.colonists.ore), org: String(pl.colonists.org), equ: String(pl.colonists.equ) })}>Reassign jobs</button>}
        </div>
        {p.colonists > 0 && (
          <div className="action-row">
            <span className="label">Unload</span>
            {input("col", String(p.colonists))}
            <span className="muted small">colonists to</span>
            {(Object.keys(GROUP_LABEL) as Group[]).map((g) => (
              <button key={g} disabled={busy} onClick={() => xfer("colonists", num("col") || p.colonists, g)}>{GROUP_LABEL[g]}</button>
            ))}
          </div>
        )}
      </section>

      <section>
        <h4>Storage <span className="muted small">you have {free} free holds</span></h4>
        <table className="slots">
          <thead><tr><th>Item</th><th>Planet</th><th>Ship</th><th /></tr></thead>
          <tbody>
            {([["ore", "Fuel Ore", pl.stock.ore, p.cargo.ore], ["org", "Organics", pl.stock.org, p.cargo.org], ["equ", "Equipment", pl.stock.equ, p.cargo.equ], ["fighters", "Fighters", pl.fighters, p.fighters]] as const).map(([k, label, onPlanet, onShip]) => (
              <tr key={k}>
                <td><span className="with-icon"><Icon item={k} />{label}</span></td><td>{fmt(onPlanet)}</td><td>{fmt(onShip)}</td>
                <td className="trade-cell">
                  {input(k)}
                  <button disabled={busy || !onShip} title="Ship to planet" onClick={() => xfer(k, num(k) || onShip)}>Drop</button>
                  <button disabled={busy || !onPlanet} title="Planet to ship" onClick={() => xfer(k, -(num(k) || Math.min(onPlanet, k === "fighters" ? onPlanet : free)))}>Take</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="muted small">Leave the box empty to move as much as fits.</div>
      </section>

      <section>
        <h4>Citadel</h4>
        {building ? (
          <p>Building level {building.level}, {CITADEL_LEVELS[building.level - 1]!.name}: {building.daysLeft} day{building.daysLeft > 1 ? "s" : ""} to go (advances at each daily reset).</p>
        ) : next ? (
          <div className="citadel-next">
            <div><strong>Next: level {next.level}, {CITADEL_LEVELS[next.level - 1]!.name}.</strong> <span className="muted">{CITADEL_LEVELS[next.level - 1]!.adds}.</span></div>
            <div className="muted small">
              Needs {fmt(next.colonists)} colonists on the planet (have {fmt(totalCol)}), and uses {fmt(next.ore)} Fuel Ore, {fmt(next.org)} Organics, {fmt(next.equ)} Equipment. Takes {next.days} day{next.days > 1 ? "s" : ""}.
            </div>
            <button className="primary" disabled={busy} onClick={() => run(async () => { await api.buildCitadel(gameId); return `Construction of level ${next.level} started.`; })}>Start building</button>
          </div>
        ) : <p>The citadel is complete.</p>}
      </section>

      {pl.citadel >= 1 && (
        <section>
          <h4>Treasury <span className="muted small">pays daily interest</span></h4>
          <div className="action-row">
            <span>{fmt(pl.credits)} credits</span>
            {input("cr", "amount")}
            <button disabled={busy} onClick={() => run(async () => { onState(await api.treasury(gameId, num("cr") || p.credits)); return "Deposited."; })}>Deposit</button>
            <button disabled={busy || !pl.credits} onClick={() => run(async () => { onState(await api.treasury(gameId, -(num("cr") || pl.credits))); return "Withdrawn."; })}>Withdraw</button>
          </div>
        </section>
      )}

      {pl.citadel >= 2 && (
        <section>
          <h4>Defenses</h4>
          <div className="defense-grid">
            <label>Military reaction %<span className="muted small">share of planet fighters that hit enemies entering the sector</span>
              <input className="num" defaultValue={pl.militaryPct} onBlur={(e) => run(async () => { await api.planetSettings(gameId, { militaryPct: Number(e.target.value) }); })} /></label>
            {pl.citadel >= 3 && <>
              <label>Q-cannon, sector %<span className="muted small">share of Fuel Ore fired at ships entering</span>
                <input className="num" defaultValue={pl.qSectorPct} onBlur={(e) => run(async () => { await api.planetSettings(gameId, { qSectorPct: Number(e.target.value) }); })} /></label>
              <label>Q-cannon, atmospheric %<span className="muted small">share of Fuel Ore fired at attackers</span>
                <input className="num" defaultValue={pl.qAtmoPct} onBlur={(e) => run(async () => { await api.planetSettings(gameId, { qAtmoPct: Number(e.target.value) }); })} /></label>
            </>}
          </div>
          {pl.citadel >= 5 && (
            <div className="action-row">
              <span className="label with-icon"><Icon item="shields" />Shields</span>
              <span>{fmt(pl.shields)} planetary</span>
              {input("sh", String(p.shields))}
              <button disabled={busy || p.shields < 10} onClick={() => run(async () => { onState(await api.planetShields(gameId, num("sh") || p.shields)); return "Shields charged."; })}>Charge from ship (10:1)</button>
            </div>
          )}
          {pl.citadel >= 6 && (
            <label className="inline">
              <input type="checkbox" checked={pl.interdictor} onChange={(e) => run(async () => { await api.planetSettings(gameId, { interdictor: e.target.checked }); })} />
              Interdictor Generator: hold enemy ships in this sector
            </label>
          )}
        </section>
      )}

      {pl.citadel >= 4 && (
        <section>
          <h4>Planetary TransWarp</h4>
          <div className="action-row">
            {input("to", "sector #")}
            <button disabled={busy || !num("to")} onClick={() => run(async () => { const r = await api.planetWarp(gameId, num("to")); onState(r.state); onReport(r.report); })}>Move planet</button>
            <span className="muted small">Burns Fuel Ore per sector jumped; you ride along.</span>
          </div>
        </section>
      )}

      {pl.citadel >= 1 && pl.mine && (
        <section>
          <h4>{p.corp ? "Corporate planet scan" : "Planet scan"}</h4>
          {!scan ? (
            <button disabled={busy} onClick={() => run(async () => { setScan(await api.corpPlanetScan(gameId)); })}>
              Scan {p.corp ? `${p.corp.name}'s` : "your"} planets
            </button>
          ) : (
            <>
              <div className="scroll-x"><table className="slots scan-table">
                <thead><tr><th>Planet</th><th>Sector</th><th>Citadel</th><th>Fighters</th><th>Shields</th><th>Colonists</th><th>Treasury</th></tr></thead>
                <tbody>
                  {scan.map((c) => (
                    <tr key={c.id} className={c.id === pl.id ? "here" : ""}>
                      <td>{c.name} <span className="muted small">{c.cls}{p.corp ? ` · ${c.owner}` : ""}</span></td>
                      <td>{c.sector}</td>
                      <td>{c.citadel}{c.building ? "+" : ""}</td>
                      <td>{fmt(c.fighters)}</td>
                      <td>{fmt(c.shields)}</td>
                      <td>{fmt(c.colonists)}</td>
                      <td>{fmt(c.credits)}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
              <button className="link" onClick={() => setScan(null)}>Hide</button>
            </>
          )}
        </section>
      )}

      {msg && <div className={`port-msg ${msg.tone ?? ""}`}>{msg.text}</div>}
    </div>
  );
}
