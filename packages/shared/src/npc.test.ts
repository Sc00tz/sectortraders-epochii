import { describe, expect, it } from "vitest";
import { makeRng } from "./random";
import { raiderCount, raiderName, veyCount, veyName, wouldDestroy } from "./npc";

describe("npc helpers", () => {
  it("scales populations with galaxy size unless set", () => {
    expect(raiderCount({ mawRaiders: 0, sectors: 1000 })).toBe(5);
    expect(raiderCount({ mawRaiders: 0, sectors: 100 })).toBe(2);
    expect(raiderCount({ mawRaiders: 9, sectors: 100 })).toBe(9);
    expect(veyCount({ veyTraders: 0, sectors: 30000 })).toBe(25);
  });

  it("names carry the faction", () => {
    const r = makeRng(7);
    expect(raiderName(r)).toMatch(/ of the Maw$/);
    expect(veyName(r)).toMatch(/^[A-Z][a-z]+ of the Vey$/);
  });

  it("only picks fights it would win", () => {
    // 400 raider fighters at 1:1 vs 100 fighters at 0.6 and no shields: overwhelmed.
    expect(wouldDestroy({ fighters: 400, odds: 1 }, { fighters: 100, odds: 0.6, shields: 0 }, 2)).toBe(true);
    // Same raider vs a battleship with 4,500 fighters: no.
    expect(wouldDestroy({ fighters: 400, odds: 1 }, { fighters: 4500, odds: 1.6, shields: 200 }, 2)).toBe(false);
    // Enough to beat the fighters but not the shields: no.
    expect(wouldDestroy({ fighters: 400, odds: 1 }, { fighters: 100, odds: 1, shields: 200 }, 2)).toBe(false);
  });
});

import { EVIL_TITLES, GOOD_TITLES, nextRankXp, rankTier, rankTitle } from "./ranks";
describe("ranks", () => {
  it("has 22 doubling thresholds from 2 to 4,194,304 XP and a title for each tier", () => {
    expect(GOOD_TITLES.length).toBe(23);
    expect(EVIL_TITLES.length).toBe(23);
    expect(rankTier(0)).toBe(0);
    expect(rankTier(1)).toBe(0);
    expect(rankTier(2)).toBe(1);
    expect(rankTier(4_194_303)).toBe(21);
    expect(rankTier(4_194_304)).toBe(22);
    expect(nextRankXp(4_194_304)).toBeNull();
    expect(nextRankXp(1000)).toBe(1024);
  });
  it("picks the evil title set below zero alignment", () => {
    expect(rankTitle(600, 10)).toBe(GOOD_TITLES[9]);
    expect(rankTitle(600, -1)).toBe(EVIL_TITLES[9]);
  });
});
