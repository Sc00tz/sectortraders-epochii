import type { Commodity } from "./commodities";

/**
 * Planet classes from the spec (Cabal planet handbook). Production ratios are colonists per
 * 1 unit per day (lower is better, null = can't produce). figFactor divides total daily
 * commodity output into fighters.
 */
export interface PlanetClass {
  id: PlanetClassId;
  name: string;
  ratio: Record<Commodity, number | null>;
  figFactor: number | null;
  maxColonists: number;
  /** Citadel figures as published (colonists, ore, org, equ, days). We treat them as all six levels combined. */
  citadelTotal: { colonists: number; ore: number; org: number; equ: number; days: number };
  sprite: string;
  genesisWeight: number; // our choice: U worlds are rarer
}

export type PlanetClassId = "M" | "K" | "O" | "L" | "C" | "H" | "U";

export const PLANET_CLASSES: Record<PlanetClassId, PlanetClass> = {
  M: { id: "M", name: "Earth-like", ratio: { ore: 3, org: 7, equ: 13 }, figFactor: 10, maxColonists: 30000, citadelTotal: { colonists: 6000, ore: 3300, org: 3300, equ: 5000, days: 43 }, sprite: "planet_m", genesisWeight: 3 },
  K: { id: "K", name: "Desert", ratio: { ore: 2, org: 100, equ: 500 }, figFactor: 15, maxColonists: 40000, citadelTotal: { colonists: 8000, ore: 3500, org: 2980, equ: 5050, days: 36 }, sprite: "planet_k", genesisWeight: 3 },
  O: { id: "O", name: "Oceanic", ratio: { ore: 20, org: 2, equ: 100 }, figFactor: 15, maxColonists: 200000, citadelTotal: { colonists: 8000, ore: 3000, org: 2850, equ: 4750, days: 36 }, sprite: "planet_o", genesisWeight: 2 },
  L: { id: "L", name: "Mountainous", ratio: { ore: 2, org: 5, equ: 20 }, figFactor: 12, maxColonists: 40000, citadelTotal: { colonists: 7000, ore: 3250, org: 3200, equ: 5100, days: 37 }, sprite: "planet_l", genesisWeight: 3 },
  C: { id: "C", name: "Glacial", ratio: { ore: 50, org: 100, equ: 500 }, figFactor: 25, maxColonists: 100000, citadelTotal: { colonists: 9000, ore: 2600, org: 2980, equ: 4750, days: 34 }, sprite: "planet_c", genesisWeight: 2 },
  H: { id: "H", name: "Volcanic", ratio: { ore: 1, org: null, equ: 500 }, figFactor: 50, maxColonists: 100000, citadelTotal: { colonists: 10000, ore: 9000, org: 6000, equ: 12000, days: 52 }, sprite: "planet_h", genesisWeight: 2 },
  U: { id: "U", name: "Gaseous", ratio: { ore: null, org: null, equ: null }, figFactor: null, maxColonists: 3000, citadelTotal: { colonists: 8000, ore: 3200, org: 1200, equ: 4800, days: 34 }, sprite: "planet_u", genesisWeight: 1 },
};

export const CITADEL_LEVELS = [
  { level: 1, name: "Planetary Treasury", adds: "Stores credits and pays daily interest" },
  { level: 2, name: "Combat Control Computer", adds: "Planet fighters fight at 2:1 attacking, 3:1 defending; military reaction" },
  { level: 3, name: "Quasar Cannon", adds: "Fires on enemy ships entering the sector or attacking the planet, powered by Fuel Ore" },
  { level: 4, name: "Planetary TransWarp", adds: "Moves the planet, using Fuel Ore per sector jumped" },
  { level: 5, name: "Planetary Shield", adds: "Converts ship shields into planetary shields" },
  { level: 6, name: "Interdictor Generator", adds: "Stops enemy ships leaving the sector, using Fuel Ore per attempt" },
] as const;

/**
 * Cost of building citadel level `level` (1-6). The published per-class figures don't say whether
 * they are per level or all six; we read them as all six and spread them with weights 1..6
 * (sum 21), so later levels cost more. Colonists are a requirement to be on the planet, not spent.
 */
export function citadelCost(cls: PlanetClassId, level: number) {
  const t = PLANET_CLASSES[cls].citadelTotal;
  const w = level / 21;
  return {
    colonists: Math.round((t.colonists * level) / 6),
    ore: Math.round(t.ore * w),
    org: Math.round(t.org * w),
    equ: Math.round(t.equ * w),
    days: Math.max(1, Math.round(t.days * w)),
  };
}

/**
 * Output falls off past half capacity (spec: production peaks at 50% of max colonists).
 * Past the peak, each extra colonist costs half a productive colonist (our curve).
 */
export function effectiveShare(total: number, max: number): number {
  if (total <= 0) return 0;
  const half = max / 2;
  if (total <= half) return 1;
  const eff = Math.max(0, half - (total - half) * 0.5);
  return eff / total;
}

export interface Colonists { ore: number; org: number; equ: number }

export function dailyProduction(cls: PlanetClassId, col: Colonists) {
  const c = PLANET_CLASSES[cls];
  const total = col.ore + col.org + col.equ;
  const k = effectiveShare(total, c.maxColonists);
  const make = (g: Commodity) => (c.ratio[g] ? Math.floor((col[g] * k) / c.ratio[g]!) : 0);
  const out = { ore: make("ore"), org: make("org"), equ: make("equ") };
  const fighters = c.figFactor ? Math.floor((out.ore + out.org + out.equ) / c.figFactor) : 0;
  return { ...out, fighters };
}

/** Quasar cannon: ore burned and damage done. Sector shot = ore x pct / 3; atmospheric = ore x pct x k. */
export function qCannonShot(ore: number, pct: number, kind: "sector" | "atmo", atmoMultiplier: number) {
  const burned = Math.floor((ore * pct) / 100);
  const damage = kind === "sector" ? Math.floor(burned / 3) : Math.floor(burned * atmoMultiplier);
  return { burned, damage };
}

/**
 * Assault on a planet: planetary shields soak first (each absorbs `shieldOdds` fighters),
 * then the planet's fighters fight at the planet's defensive odds.
 */
export function resolvePlanetAssault(a: {
  attFighters: number; attOdds: number; shields: number; shieldOdds: number; defFighters: number; defOdds: number;
}) {
  let A = Math.max(0, Math.floor(a.attFighters));
  const shieldsLost = Math.min(a.shields, Math.floor(A / a.shieldOdds));
  const spentOnShields = shieldsLost * a.shieldOdds;
  A -= spentOnShields;
  if (shieldsLost < a.shields) {
    // Shields held: the whole wave is spent on them.
    return { attLost: a.attFighters, shieldsLost, fightersLost: 0, captured: false };
  }
  const powerA = A * a.attOdds, powerD = a.defFighters * a.defOdds;
  if (powerA <= powerD) {
    return { attLost: a.attFighters, shieldsLost, fightersLost: Math.min(a.defFighters, Math.floor(powerA / a.defOdds)), captured: false };
  }
  const spent = Math.min(A, Math.ceil(powerD / a.attOdds));
  return { attLost: spentOnShields + spent, shieldsLost, fightersLost: a.defFighters, captured: true };
}

export function rollPlanetClass(rand: () => number = Math.random): PlanetClassId {
  const entries = Object.values(PLANET_CLASSES);
  const total = entries.reduce((s, c) => s + c.genesisWeight, 0);
  let r = rand() * total;
  for (const c of entries) if ((r -= c.genesisWeight) < 0) return c.id;
  return "M";
}
