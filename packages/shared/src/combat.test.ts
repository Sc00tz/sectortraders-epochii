import { describe, it, expect } from "vitest";
import { applyDamage, armidsTriggered, fedProtected, resolveCombat } from "./combat";
import { DEFAULT_SETTINGS as S } from "./settings";
import { holdsCost } from "./ships";

const base = { attOdds: 1, defOdds: 1, defShields: 0, shieldOdds: 2 };

describe("combat", () => {
  it("weaker attack is wiped out and takes an equal number of defenders at even odds", () => {
    expect(resolveCombat({ ...base, attFighters: 100, defFighters: 300 })).toEqual({ attLost: 100, defFightersLost: 100, defShieldsLost: 0, destroyed: false });
  });
  it("odds scale kills (spec: fighters x attacker odds / defender odds)", () => {
    const r = resolveCombat({ ...base, attFighters: 100, attOdds: 2, defFighters: 500 });
    expect(r.defFightersLost).toBe(200);
  });
  it("stronger attack clears fighters, then shields at 2:1, then destroys", () => {
    const r = resolveCombat({ ...base, attFighters: 500, defFighters: 200, defShields: 100 });
    // 200 spent on fighters, 200 spent on 100 shields, 100 left over -> destroyed
    expect(r).toEqual({ attLost: 400, defFightersLost: 200, defShieldsLost: 100, destroyed: true });
  });
  it("shields that hold mean no kill", () => {
    const r = resolveCombat({ ...base, attFighters: 300, defFighters: 200, defShields: 100 });
    expect(r.destroyed).toBe(false);
    expect(r.defShieldsLost).toBe(50);
  });
  it("an exact tie in power is not a win", () => {
    expect(resolveCombat({ ...base, attFighters: 100, defFighters: 100 }).destroyed).toBe(false);
  });
  it("a strong defensive hull (4:1) needs four times the fighters", () => {
    const r = resolveCombat({ ...base, attFighters: 399, defFighters: 100, defOdds: 4 });
    expect(r.defFightersLost).toBeLessThan(100);
  });
});

describe("mines, protection, holds", () => {
  it("mine damage hits shields first, then fighters, then the hull", () => {
    expect(applyDamage(50, 30, 40)).toEqual({ shieldsLost: 40, fightersLost: 10, destroyed: false });
    expect(applyDamage(100, 30, 40).destroyed).toBe(true);
  });
  it("counts detonations with the given chance", () => {
    let i = 0;
    const seq = [0.1, 0.9, 0.2, 0.8];
    expect(armidsTriggered(4, 0.5, () => seq[i++]!)).toBe(2);
  });
  it("FedSpace protects small, good, low-XP traders only", () => {
    expect(fedProtected(S, { alignment: 0, experience: 10, fighters: 30 })).toBe(true);
    expect(fedProtected(S, { alignment: -1, experience: 10, fighters: 30 })).toBe(false);
    expect(fedProtected(S, { alignment: 5, experience: 1000, fighters: 30 })).toBe(false);
    expect(fedProtected(S, { alignment: 5, experience: 10, fighters: 50 })).toBe(false);
  });
  it("holds get pricier as you buy more", () => {
    expect(holdsCost(S, 20, 1)).toBe(S.holdPriceBase + S.holdPriceStep * 20);
    expect(holdsCost(S, 20, 2)).toBe(2 * S.holdPriceBase + S.holdPriceStep * 41);
  });
});
