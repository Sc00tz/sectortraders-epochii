import { describe, it, expect } from "vitest";
import { PLANET_CLASSES, citadelCost, dailyProduction, effectiveShare, qCannonShot, resolvePlanetAssault, rollPlanetClass } from "./planets";

describe("planet production", () => {
  it("uses the class ratios (colonists per unit)", () => {
    expect(dailyProduction("M", { ore: 3000, org: 7000, equ: 1300 })).toEqual({ ore: 1000, org: 1000, equ: 100, fighters: 210 });
  });
  it("can't make what the class can't produce", () => {
    const h = dailyProduction("H", { ore: 100, org: 1000, equ: 0 });
    expect(h.org).toBe(0);
    expect(dailyProduction("U", { ore: 1000, org: 1000, equ: 1000 })).toEqual({ ore: 0, org: 0, equ: 0, fighters: 0 });
  });
  it("output peaks at half capacity, then falls off", () => {
    const max = PLANET_CLASSES.M.maxColonists;
    expect(effectiveShare(max / 2, max)).toBe(1);
    const atHalf = dailyProduction("M", { ore: max / 2, org: 0, equ: 0 }).ore;
    const atFull = dailyProduction("M", { ore: max, org: 0, equ: 0 }).ore;
    expect(atFull).toBeLessThan(atHalf);
  });
});

describe("citadel costs", () => {
  it("six levels add up to the published class totals", () => {
    for (const cls of Object.keys(PLANET_CLASSES) as (keyof typeof PLANET_CLASSES)[]) {
      const t = PLANET_CLASSES[cls].citadelTotal;
      let ore = 0;
      for (let l = 1; l <= 6; l++) ore += citadelCost(cls, l).ore;
      expect(Math.abs(ore - t.ore)).toBeLessThanOrEqual(3);
      expect(citadelCost(cls, 6).colonists).toBe(t.colonists);
    }
  });
  it("later levels cost more", () => {
    expect(citadelCost("M", 6).equ).toBeGreaterThan(citadelCost("M", 1).equ);
  });
});

describe("planet combat", () => {
  it("Q-cannon: sector shot is ore x pct / 3", () => {
    expect(qCannonShot(9000, 30, "sector", 0.5)).toEqual({ burned: 2700, damage: 900 });
    expect(qCannonShot(1000, 10, "atmo", 0.5)).toEqual({ burned: 100, damage: 50 });
  });
  it("planetary shields soak 20 fighters each before the fighters fight", () => {
    const held = resolvePlanetAssault({ attFighters: 1000, attOdds: 1, shields: 100, shieldOdds: 20, defFighters: 0, defOdds: 3 });
    expect(held).toMatchObject({ captured: false, shieldsLost: 50, attLost: 1000 });
    const won = resolvePlanetAssault({ attFighters: 3000, attOdds: 1, shields: 100, shieldOdds: 20, defFighters: 200, defOdds: 3 });
    expect(won).toMatchObject({ captured: true, shieldsLost: 100, fightersLost: 200, attLost: 2600 });
  });
  it("an undefended planet falls to any attack", () => {
    expect(resolvePlanetAssault({ attFighters: 1, attOdds: 1, shields: 0, shieldOdds: 20, defFighters: 0, defOdds: 1 }).captured).toBe(true);
  });
  it("rolls every class", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(rollPlanetClass(() => i / 100));
    expect(seen.size).toBe(7);
  });
});
