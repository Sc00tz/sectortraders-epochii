import type { Commodity } from "./commodities";

export type TradeDir = "buy" | "sell"; // from the PORT's point of view

/** Port classes 1-8: pattern is Ore / Organics / Equipment, B = port buys, S = port sells. */
export const PORT_CLASS_PATTERN: Record<number, [TradeDir, TradeDir, TradeDir]> = {
  1: ["buy", "buy", "sell"], // BBS
  2: ["buy", "sell", "buy"], // BSB
  3: ["sell", "buy", "buy"], // SBB
  4: ["sell", "sell", "buy"], // SSB
  5: ["sell", "buy", "sell"], // SBS
  6: ["buy", "sell", "sell"], // BSS
  7: ["sell", "sell", "sell"], // SSS
  8: ["buy", "buy", "buy"], // BBB
};

/** Generation weights: classes 1-3 make up roughly 60% of ports. */
export const PORT_CLASS_WEIGHTS: [number, number][] = [
  [1, 20], [2, 20], [3, 20], [4, 10], [5, 10], [6, 10], [7, 5], [8, 5],
];

export const SPECIAL_CLASS = { depot: 0, stardock: 9 } as const;

export function portPatternCode(cls: number): string {
  if (cls === 0) return "Special";
  if (cls === 9) return "Keystone";
  return PORT_CLASS_PATTERN[cls]!.map((d) => (d === "buy" ? "B" : "S")).join("");
}

export function portDir(cls: number, c: Commodity): TradeDir | null {
  const p = PORT_CLASS_PATTERN[cls];
  if (!p) return null;
  return p[c === "ore" ? 0 : c === "org" ? 1 : 2];
}
