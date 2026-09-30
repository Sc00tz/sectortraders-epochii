import { PLACE,
  COMMODITIES, PORT_CLASS_WEIGHTS, makeRng, portDir, rollPlanetClass, type GameSettings, type PlanetClassId, type PortSlot, type Rng,
} from "@st/shared";
import type { PortSlots } from "./db/schema";

export interface GenSector { id: number; x: number; y: number; fedspace: boolean }
export interface GenPort { sectorId: number; name: string; cls: number; slots: PortSlots }
export interface GenPlanet { sectorId: number; name: string; cls: PlanetClassId }
export interface Universe {
  planets: GenPlanet[];
  sectors: GenSector[];
  warps: [number, number][]; // directed edges
  ports: GenPort[];
  stardock: number;
  depots: number[];
}

const MAP_SIZE = 1000;

/** Uniform grid for near-neighbour lookups on the 2D map layout. */
class Grid {
  private cells = new Map<string, number[]>();
  constructor(private cell: number, private pts: { x: number; y: number }[]) {}
  private key(cx: number, cy: number) { return `${cx},${cy}`; }
  add(i: number) {
    const p = this.pts[i]!;
    const k = this.key(Math.floor(p.x / this.cell), Math.floor(p.y / this.cell));
    const arr = this.cells.get(k);
    if (arr) arr.push(i); else this.cells.set(k, [i]);
  }
  /** Up to k nearest indices to point i (excluding i), searched ring by ring. */
  nearest(i: number, k: number, accept: (j: number) => boolean = () => true): number[] {
    const p = this.pts[i]!;
    const cx = Math.floor(p.x / this.cell), cy = Math.floor(p.y / this.cell);
    const found: { j: number; d: number }[] = [];
    const maxRing = Math.ceil(MAP_SIZE / this.cell) + 1;
    for (let r = 0; r <= maxRing; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          for (const j of this.cells.get(this.key(cx + dx, cy + dy)) ?? []) {
            if (j === i || !accept(j)) continue;
            const q = this.pts[j]!;
            found.push({ j, d: (q.x - p.x) ** 2 + (q.y - p.y) ** 2 });
          }
        }
      }
      // Anything outside ring r is at least r*cell away, so we can stop once k are closer than that.
      if (found.length >= k) {
        const lim = (r * this.cell) ** 2;
        const sorted = found.sort((a, b) => a.d - b.d);
        if (sorted[k - 1]!.d <= lim) return sorted.slice(0, k).map((f) => f.j);
      }
    }
    return found.sort((a, b) => a.d - b.d).slice(0, k).map((f) => f.j);
  }
}

const SYL_A = ["Ar", "Bel", "Cor", "Dra", "El", "Fen", "Gal", "Hal", "Ix", "Jor", "Kel", "Lor", "Mar", "Nor", "Or", "Pra", "Quel", "Ras", "Sol", "Tar", "Ul", "Ver", "Wex", "Yor", "Zan"];
const SYL_B = ["a", "e", "i", "o", "u", "ae", "io", "ea"];
const SYL_C = ["dor", "lis", "mar", "nex", "phos", "rin", "tis", "vane", "xar", "zeth", "gard", "mont", "ria", "thys"];
const SUFFIX = ["Station", "Exchange", "Depot", "Outpost", "Hub", "Market", "Terminal", "Yards"];
const PLANET_SUFFIX = ["Prime", "Minor", "Major", "II", "III", "IV", "Reach", "Rest", "Hollow", "Gate"];

/** A planet name from the same syllable set as ports. */
export function planetName(rng: Rng | { next: () => number; pick: <T>(a: readonly T[]) => T }): string {
  const base = `${rng.pick(SYL_A)}${rng.pick(SYL_B)}${rng.pick(SYL_C)}`;
  return rng.next() < 0.5 ? base : `${base} ${rng.pick(PLANET_SUFFIX)}`;
}

function portName(rng: Rng, used: Set<string>): string {
  for (let tries = 0; tries < 50; tries++) {
    const n = `${rng.pick(SYL_A)}${rng.pick(SYL_B)}${rng.pick(SYL_C)} ${rng.pick(SUFFIX)}`;
    if (!used.has(n)) { used.add(n); return n; }
  }
  const n = `Trade Post ${used.size + 1}`;
  used.add(n);
  return n;
}

function makeSlots(s: GameSettings, rng: Rng, cls: number): PortSlots {
  const slots: PortSlots = {};
  for (const c of COMMODITIES) {
    const dir = portDir(cls, c);
    if (!dir) continue;
    const max = rng.int(s.portMaxStockMin, s.portMaxStockMax);
    const slot: PortSlot = {
      dir,
      max,
      stock: Math.round(max * (0.6 + rng.next() * 0.4)),
      priceFactor: 1 + (rng.next() * 2 - 1) * s.portPriceSpread,
    };
    slots[c] = slot;
  }
  return slots;
}

/** Big Bang: lay sectors out on a 2D map, connect them, and seed ports. Deterministic for a given seed. */
export function generateUniverse(s: GameSettings, seed: number): Universe {
  const rng = makeRng(seed);
  const n = s.sectors;
  const fed = Math.min(s.fedspaceSectors, n);
  const maxW = s.maxWarpsPerSector;

  // 1. Positions (index 0 unused so index = sector id). FedSpace clusters around the map centre.
  const pts: { x: number; y: number }[] = [{ x: 0, y: 0 }];
  for (let id = 1; id <= n; id++) {
    if (id <= fed) {
      const a = rng.next() * Math.PI * 2, r = 20 + rng.next() * 60;
      pts.push({ x: MAP_SIZE / 2 + Math.cos(a) * r, y: MAP_SIZE / 2 + Math.sin(a) * r });
    } else {
      pts.push({ x: rng.next() * MAP_SIZE, y: rng.next() * MAP_SIZE });
    }
  }
  const grid = new Grid(Math.max(5, (MAP_SIZE / Math.sqrt(n)) * 1.5), pts);

  const out = new Map<number, Set<number>>();
  for (let id = 1; id <= n; id++) out.set(id, new Set());
  const deg = (id: number) => out.get(id)!.size;
  const linked = (a: number, b: number) => out.get(a)!.has(b) || out.get(b)!.has(a);
  const link2 = (a: number, b: number) => { out.get(a)!.add(b); out.get(b)!.add(a); };

  // 2. FedSpace: a ring 1..fed with a couple of chords.
  for (let id = 1; id <= fed; id++) {
    grid.add(id);
    if (id > 1) link2(id - 1, id);
  }
  if (fed > 2) link2(fed, 1);
  if (fed > 5) link2(1, Math.ceil(fed / 2) + 1);

  // 3. Spanning tree: grow outward from FedSpace (distance from the centre, with jitter so it
  //    isn't a perfect spiral). Each sector links to its nearest already-placed sector, which keeps
  //    warps short instead of drawing long lines across the map.
  const jitter = MAP_SIZE * 0.08;
  const keyOf = new Map<number, number>();
  const order: number[] = [];
  for (let id = fed + 1; id <= n; id++) {
    const p = pts[id]!;
    keyOf.set(id, Math.hypot(p.x - MAP_SIZE / 2, p.y - MAP_SIZE / 2) + rng.next() * jitter);
    order.push(id);
  }
  order.sort((a, b) => keyOf.get(a)! - keyOf.get(b)!);
  const placed = new Set<number>(Array.from({ length: fed }, (_, i) => i + 1));
  for (const id of order) {
    const [near] = grid.nearest(id, 1, (j) => placed.has(j) && deg(j) < maxW);
    if (near === undefined) throw new Error("universe generation: no attachable sector");
    link2(id, near);
    placed.add(id);
    grid.add(id);
  }

  // 4. Extra two-way warps between near neighbours (keeps the map readable).
  const extra2 = Math.round(n * s.twoWayWarpDensity);
  for (let made = 0, tries = 0; made < extra2 && tries < extra2 * 20; tries++) {
    const a = rng.int(1, n);
    if (deg(a) >= maxW) continue;
    const cands = grid.nearest(a, 6, (j) => deg(j) < maxW && !linked(a, j));
    if (!cands.length) continue;
    link2(a, rng.pick(cands));
    made++;
  }

  // 5. One-way warps. Added on top of a connected two-way graph, so every sector stays reachable.
  const extra1 = Math.round(n * s.oneWayWarpDensity);
  for (let made = 0, tries = 0; made < extra1 && tries < extra1 * 20; tries++) {
    const a = rng.int(1, n);
    if (deg(a) >= maxW) continue;
    const cands = grid.nearest(a, 10, (j) => !linked(a, j)).slice(3);
    if (!cands.length) continue;
    out.get(a)!.add(rng.pick(cands));
    made++;
  }

  // 6. Special locations. Stardock sits outside the core FedSpace ring but counts as FedSpace.
  const pool = order.filter((id) => deg(id) >= 2);
  const stardock = pool.length ? rng.pick(pool) : n;
  const depots = [1];
  while (depots.length < 3 && n > fed + 3) {
    const d = rng.int(fed + 1, n);
    if (d !== stardock && !depots.includes(d)) depots.push(d);
  }

  const sectors: GenSector[] = [];
  for (let id = 1; id <= n; id++) {
    sectors.push({ id, x: Math.round(pts[id]!.x * 10) / 10, y: Math.round(pts[id]!.y * 10) / 10, fedspace: id <= fed || id === stardock });
  }
  const warps: [number, number][] = [];
  for (const [a, set] of out) for (const b of set) warps.push([a, b]);

  // 7. Ports.
  const names = new Set<string>();
  const ports: GenPort[] = [];
  ports.push({ sectorId: stardock, name: PLACE.keystone, cls: 9, slots: {} });
  depots.forEach((d, i) => ports.push({ sectorId: d, name: PLACE.depots[i]!, cls: 0, slots: {} }));
  const chance = s.portDensity * s.portsBuiltPct;
  for (let id = 1; id <= n; id++) {
    if (id === stardock || depots.includes(id)) continue;
    if (rng.next() >= chance) continue;
    const cls = rng.weighted(PORT_CLASS_WEIGHTS);
    ports.push({ sectorId: id, name: portName(rng, names), cls, slots: makeSlots(s, rng, cls) });
  }

  // 8. Unowned planets scattered outside FedSpace, free to claim.
  const planets: GenPlanet[] = [];
  const target = Math.round(n * s.bigBangPlanetPct);
  for (let tries = 0; planets.length < target && tries < target * 20; tries++) {
    const id = rng.int(fed + 1, n);
    if (id === stardock) continue;
    planets.push({ sectorId: id, name: planetName(rng), cls: rollPlanetClass(rng.next) });
  }

  return { sectors, warps, ports, stardock, depots, planets };
}

/** Breadth-first shortest path over directed warps. Returns the list of sectors after `from`, or null. */
export function plotCourse(adj: Map<number, number[]>, from: number, to: number, maxLen: number): number[] | null {
  if (from === to) return [];
  const prev = new Map<number, number>([[from, from]]);
  let frontier = [from];
  for (let depth = 0; depth < maxLen && frontier.length; depth++) {
    const next: number[] = [];
    for (const u of frontier) {
      for (const v of adj.get(u) ?? []) {
        if (prev.has(v)) continue;
        prev.set(v, u);
        if (v === to) {
          const path = [v];
          let c = u;
          while (c !== from) { path.push(c); c = prev.get(c)!; }
          return path.reverse();
        }
        next.push(v);
      }
    }
    frontier = next;
  }
  return null;
}
