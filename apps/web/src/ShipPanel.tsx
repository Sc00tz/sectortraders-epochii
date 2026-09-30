import { useEffect, useState } from "react";
import { PLACE, COMMODITIES, COMMODITY_LABEL, GEAR, SHIP_TYPES, nextRankXp, rankTitle, type LimpetTrackDto, type MeDto, type StateDto } from "@st/shared";
import { api, fmt } from "./api";
import { Icon } from "./Icon";

function Bar({ label, value, max, tone, icon }: { label: string; value: number; max: number; tone: string; icon?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="bar">
      <div className="bar-head"><span className="with-icon">{icon && <Icon item={icon} size={16} />}{label}</span><span>{fmt(value)} / {fmt(max)}</span></div>
      <div className="bar-track"><div className={`bar-fill ${tone}`} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

export function ShipPanel({ gameId, state, me, onAdminReset }: { gameId: number; state: StateDto; me: MeDto; onAdminReset: () => void }) {
  const p = state.player;
  const ship = SHIP_TYPES[p.ship]!;
  const used = p.cargo.ore + p.cargo.org + p.cargo.equ + p.colonists;
  const [tracks, setTracks] = useState<LimpetTrackDto[]>([]);
  useEffect(() => { api.limpets(gameId).then(setTracks).catch(() => {}); }, [gameId, state]);

  return (
    <div className="ship">
      <div className="ship-hero">
        {ship.sprite ? <img src={`/sprites/${ship.sprite}.png`} alt={ship.name} /> : <div className="pod-art" aria-label="Escape pod" />}
        <div>
          <h3>{ship.name}</h3>
          <div className="muted small">{ship.turnsPerWarp} turns per jump · attack odds {ship.offensiveOdds} · defense odds {ship.defensiveOdds}</div>
          {p.ship === "escape_pod" && <div className="alert bad">You're in an escape pod. Head to {PLACE.keystone} for a new ship.</div>}
        </div>
      </div>

      <Bar label="Cargo holds" value={used} max={p.holds} tone="gold" icon="holds" />
      <div className="cargo-row">
        {COMMODITIES.map((c) => <span key={c}><small>{COMMODITY_LABEL[c]}</small><b className="with-icon"><Icon item={c} />{fmt(p.cargo[c])}</b></span>)}
        <span><small>Colonists</small><b className="with-icon"><Icon item="colonists" />{fmt(p.colonists)}</b></span>
        <span><small>Free</small>{fmt(p.holds - used)}</span>
        <span><small>Max holds</small>{ship.maxHolds}</span>
      </div>
      <Bar label="Fighters" value={p.fighters} max={ship.maxFighters} tone="teal" icon="fighters" />
      <Bar label="Shields" value={p.shields} max={ship.maxShields} tone="blue" icon="shields" />

      <div className="stat-grid">
        <span><small>Credits</small>{fmt(p.credits)}</span>
        <span><small>Rank</small>{rankTitle(p.experience, p.alignment)}</span>
        <span><small>Experience</small>{fmt(p.experience)}{nextRankXp(p.experience) != null && <em className="small"> next rank at {fmt(nextRankXp(p.experience)!)}</em>}</span>
        <span><small>Alignment</small><b className={p.alignment < 0 ? "evil" : p.alignment > 0 ? "good" : ""}>{fmt(p.alignment)}</b></span>
        <span><small>Burst mines</small><b className="with-icon"><Icon item="armid" />{p.armids}</b></span>
        <span><small>Limpet mines</small><b className="with-icon"><Icon item="limpet" />{p.limpets}</b></span>
        <span><small>Genesis torpedoes</small><b className="with-icon"><Icon item="genesis" />{p.genesis}</b></span>
        <span><small>Limpets on you</small><b className={p.limpetsAttached ? "evil" : ""}>{p.limpetsAttached}</b></span>
      </div>

      <h3>Equipment</h3>
      {GEAR.some((g) => p.gear[g.id]) ? (
        <div className="stat-grid">
          {GEAR.filter((g) => p.gear[g.id]).map((g) => <span key={g.id}><small>{g.label}</small><b className="with-icon"><Icon item={g.id} />{g.kind === "flag" ? "Installed" : fmt(p.gear[g.id]!)}</b></span>)}
          {p.cloaked && <span><small>Status</small><b className="good">Cloaked</b></span>}
        </div>
      ) : <p className="muted small">None yet. Keystone Station sells scanners, probes, photon missiles, cloaks, and more.</p>}
      {p.bustedAt.length > 0 && (
        <p className="muted small">Ports that won't deal with you: {p.bustedAt.map((b) => `sector ${b.sector} (until ${new Date(b.until).toLocaleDateString([], { month: "short", day: "numeric" })})`).join(", ")}.</p>
      )}

      <h3>Limpet tracking</h3>
      {tracks.length === 0
        ? <p className="muted small">No limpets attached to anyone. Lay limpet mines where traders pass to track them.</p>
        : <ul className="tracks">{tracks.map((t) => <li key={t.targetId}>{t.alias} <span className="muted">is in sector</span> {t.sector}</li>)}</ul>}

      <p className="muted small">
        Flat broke with empty holds? {PLACE.keystone}'s Authority office runs a hardship fund.
        Done with this galaxy for good? Go back to the galaxy list from the title in the top left and leave from there.
      </p>
      {me.isAdmin && <button className="link" onClick={onAdminReset}>Admin: run daily reset now</button>}
    </div>
  );
}
