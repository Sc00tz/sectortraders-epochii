import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, resolveSettings } from "./settings";
import { SETTINGS_META, crossCheckSettings, getSetting, validateSettingsPatch } from "./settingsMeta";

describe("settings metadata", () => {
  it("covers every setting, and every default passes its own limits", () => {
    const flat = Object.entries(DEFAULT_SETTINGS).flatMap(([k, v]) =>
      v && typeof v === "object" ? Object.keys(v).map((sub) => `${k}.${sub}`) : [k]);
    const known = new Set(SETTINGS_META.map((m) => m.key));
    // Prices for ships nobody can buy (none today) would be the only allowed gap.
    expect(flat.filter((k) => !known.has(k))).toEqual([]);
    const patch = Object.fromEntries(SETTINGS_META.map((m) => [m.key, getSetting(DEFAULT_SETTINGS, m.key)]));
    expect(() => validateSettingsPatch(patch, true)).not.toThrow();
    expect(crossCheckSettings(DEFAULT_SETTINGS)).toBeNull();
  });

  it("refuses creation-only keys on a live galaxy, bad ranges, and wrong types", () => {
    expect(() => validateSettingsPatch({ sectors: 2000 }, false)).toThrow(/only be set when a galaxy is created/);
    expect(() => validateSettingsPatch({ mawAggression: 1.5 }, false)).toThrow(/between 0 and 100%/);
    expect(() => validateSettingsPatch({ turnsPerDay: 12.5 }, false)).toThrow(/whole number/);
    expect(() => validateSettingsPatch({ npcsEnabled: "yes" }, false)).toThrow(/on or off/);
    expect(() => validateSettingsPatch({ startingShip: "corporate_flagship" }, false)).toThrow(/regular buyable ship/);
    expect(() => validateSettingsPatch({ nope: 1 }, false)).toThrow(/Unknown setting/);
  });

  it("builds nested patches that merge with the rest", () => {
    const patch = validateSettingsPatch({ "shipPrices.battleship": 50000, "commodityBasePrice.ore": 30, turnsPerDay: 800 }, false);
    const s = resolveSettings({ ...DEFAULT_SETTINGS, ...patch, shipPrices: { ...DEFAULT_SETTINGS.shipPrices, ...patch.shipPrices }, commodityBasePrice: { ...DEFAULT_SETTINGS.commodityBasePrice, ...patch.commodityBasePrice } });
    expect(s.shipPrices.battleship).toBe(50000);
    expect(s.shipPrices.scout_marauder).toBe(DEFAULT_SETTINGS.shipPrices.scout_marauder);
    expect(s.commodityBasePrice.ore).toBe(30);
    expect(s.turnsPerDay).toBe(800);
  });
});
