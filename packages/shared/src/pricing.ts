import type { Commodity } from "./commodities";
import type { GameSettings } from "./settings";
import type { TradeDir } from "./ports";

/** One commodity slot at a port. For a buying port, `stock` is the demand it still has. */
export interface PortSlot {
  dir: TradeDir;
  stock: number;
  max: number;
  priceFactor: number;
}

/**
 * Unit price for a slot at a given fill level (0..1).
 * Selling port: full stock is cheap (0.9x base), nearly empty is dear (1.3x).
 * Buying port: high demand pays well (1.3x), little demand pays poorly (0.9x).
 * The 0.9-1.3 band is our own choice (the v3 formula isn't documented) and is tunable later.
 */
export function unitPriceAt(base: number, slot: Pick<PortSlot, "dir" | "priceFactor">, fill: number): number {
  const f = Math.min(1, Math.max(0, fill));
  const mult = slot.dir === "sell" ? 1.3 - 0.4 * f : 0.9 + 0.4 * f;
  return base * slot.priceFactor * mult;
}

/** Total quoted price for `qty` units, priced at the midpoint of the stock change. */
export function quoteTotal(base: number, slot: PortSlot, qty: number): number {
  if (qty <= 0 || slot.max <= 0) return 0;
  const mid = (slot.stock - qty / 2) / slot.max;
  return Math.max(1, Math.round(qty * unitPriceAt(base, slot, mid)));
}

/** Largest quantity the player could trade with this slot, before credits are considered. */
export function maxTradeQty(slot: PortSlot, freeHolds: number, cargoHeld: number): number {
  if (slot.dir === "sell") return Math.max(0, Math.min(slot.stock, freeHolds));
  return Math.max(0, Math.min(slot.stock, cargoHeld));
}

/** Hidden haggle room for a trader: grows with XP up to the cap, then plateaus. */
export function haggleRoom(s: GameSettings, xp: number): number {
  const t = Math.min(1, Math.max(0, xp) / s.haggleXpCap);
  return s.haggleRoomMin + (s.haggleRoomMax - s.haggleRoomMin) * t;
}

/**
 * Haggle state for one offer negotiation. `dir` is the PORT's side:
 * port "sell" = player buying (wants a lower price); port "buy" = player selling (wants higher).
 */
export interface Haggle {
  dir: TradeDir;
  commodity: Commodity;
  qty: number;
  quote: number; // current asking/offering price the port will always accept
  best: number; // hidden limit the port will go to
  rounds: number;
}

export function startHaggle(s: GameSettings, dir: TradeDir, commodity: Commodity, qty: number, quote: number, xp: number): Haggle {
  const room = haggleRoom(s, xp);
  const best = dir === "sell" ? Math.floor(quote * (1 - room)) : Math.ceil(quote * (1 + room));
  return { dir, commodity, qty, quote, best, rounds: 0 };
}

export type HaggleOutcome =
  | { kind: "accepted"; price: number; xp: number }
  | { kind: "counter"; haggle: Haggle }
  | { kind: "refused" };

/** Resolve a player's offer (total credits for the whole lot). Pure function: returns the next state. */
export function resolveOffer(s: GameSettings, h: Haggle, offer: number): HaggleOutcome {
  const o = Math.round(offer);
  const playerBuying = h.dir === "sell";
  // Offer at or better than the quote (for the port): accepted as offered, no skill shown.
  if (playerBuying ? o >= h.quote : o <= h.quote) {
    return { kind: "accepted", price: playerBuying ? h.quote : o, xp: 0 };
  }
  const withinBest = playerBuying ? o >= h.best : o <= h.best;
  if (withinBest) {
    const span = Math.abs(h.quote - h.best) || 1;
    const skill = Math.abs(h.quote - o) / span; // 0..1, 1 = hit the port's limit exactly
    return { kind: "accepted", price: o, xp: Math.round(s.haggleMaxXp * skill) };
  }
  // Overbid: the port's limit moves against the player, then it counters halfway.
  const rounds = h.rounds + 1;
  if (rounds >= s.haggleMaxRounds) return { kind: "refused" };
  const shift = Math.abs(h.best - o) * s.haggleShiftPct;
  const best = playerBuying ? Math.min(h.quote, Math.round(h.best + shift)) : Math.max(h.quote, Math.round(h.best - shift));
  const quote = Math.round(best + (h.quote - best) * 0.5);
  return { kind: "counter", haggle: { ...h, best, quote, rounds } };
}
