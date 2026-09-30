import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS as S } from "./settings";
import { quoteTotal, resolveOffer, startHaggle, unitPriceAt, haggleRoom } from "./pricing";

describe("unit prices", () => {
  it("selling port is cheapest when full, dearest when empty", () => {
    const slot = { dir: "sell" as const, priceFactor: 1 };
    expect(unitPriceAt(100, slot, 1)).toBeCloseTo(90);
    expect(unitPriceAt(100, slot, 0)).toBeCloseTo(130);
  });
  it("buying port pays most with high demand", () => {
    const slot = { dir: "buy" as const, priceFactor: 1 };
    expect(unitPriceAt(100, slot, 1)).toBeCloseTo(130);
    expect(unitPriceAt(100, slot, 0)).toBeCloseTo(90);
  });
  it("paired trade between a full seller and a hungry buyer is profitable", () => {
    const buyCost = quoteTotal(58, { dir: "sell", stock: 3000, max: 3000, priceFactor: 1 }, 20);
    const sellGain = quoteTotal(58, { dir: "buy", stock: 3000, max: 3000, priceFactor: 1 }, 20);
    expect(sellGain).toBeGreaterThan(buyCost);
  });
});

describe("haggling", () => {
  it("haggle room grows with XP and plateaus at the cap", () => {
    expect(haggleRoom(S, 0)).toBeCloseTo(S.haggleRoomMin);
    expect(haggleRoom(S, 1000)).toBeCloseTo(S.haggleRoomMax);
    expect(haggleRoom(S, 50000)).toBeCloseTo(S.haggleRoomMax);
  });
  it("accepts the quote with no XP", () => {
    const h = startHaggle(S, "sell", "ore", 20, 1000, 0);
    expect(resolveOffer(S, h, 1000)).toEqual({ kind: "accepted", price: 1000, xp: 0 });
  });
  it("accepts an offer at the port's limit with full XP", () => {
    const h = startHaggle(S, "sell", "ore", 20, 1000, 0);
    const r = resolveOffer(S, h, h.best);
    expect(r).toEqual({ kind: "accepted", price: h.best, xp: S.haggleMaxXp });
  });
  it("counters a lowball, moves the limit against the player, then refuses", () => {
    const h = startHaggle(S, "sell", "ore", 20, 1000, 0);
    const r1 = resolveOffer(S, h, 950);
    expect(r1.kind).toBe("counter");
    if (r1.kind !== "counter") return;
    expect(r1.haggle.best).toBeGreaterThan(h.best);
    expect(r1.haggle.quote).toBeLessThan(1000);
    const r2 = resolveOffer(S, r1.haggle, 950);
    expect(r2.kind).toBe("counter");
    if (r2.kind !== "counter") return;
    expect(resolveOffer(S, r2.haggle, 950).kind).toBe("refused");
  });
  it("a wild lowball burns all the haggle room", () => {
    const h = startHaggle(S, "sell", "ore", 20, 1000, 0);
    const r = resolveOffer(S, h, 200);
    expect(r.kind === "counter" && r.haggle.best).toBe(1000);
  });
  it("mirrors for selling to a port (player wants more)", () => {
    const h = startHaggle(S, "buy", "equ", 20, 1000, 1000);
    expect(h.best).toBeGreaterThan(1000);
    const r = resolveOffer(S, h, h.best);
    expect(r).toMatchObject({ kind: "accepted", price: h.best, xp: S.haggleMaxXp });
    expect(resolveOffer(S, h, h.best + 500).kind).toBe("counter");
  });
});
