import type { GameSettings } from "./settings";

/**
 * Equipment sold at Keystone Station. "flag" items are installed once; "count" items are carried
 * and used up. A ship's equipment is lost with the ship.
 */
export type GearId = "transwarp" | "density" | "holo" | "planetScanner" | "probe" | "photon" | "cloak" | "corbomite" | "disruptor" | "detonator" | "beacon";
export type Gear = Partial<Record<GearId, number>>;

export interface GearDef {
  id: GearId;
  label: string;
  blurb: string;
  kind: "flag" | "count";
  price: keyof GameSettings;
  max?: keyof GameSettings;
}

export const GEAR: GearDef[] = [
  { id: "transwarp", label: "TransWarp drive", kind: "flag", price: "transwarpPrice", blurb: "Jump straight to any sector for a turn and some Fuel Ore. Only hulls built for it." },
  { id: "density", label: "Density scanner", kind: "flag", price: "densityScannerPrice", blurb: "Free scan of what's massed in each neighboring sector." },
  { id: "holo", label: "Holo scanner", kind: "flag", price: "holoScannerPrice", blurb: "A turn to see ports, ships, planets, and fighters next door." },
  { id: "planetScanner", label: "Planet scanner", kind: "flag", price: "planetScannerPrice", blurb: "See a planet's defenses and stock before you land or attack." },
  { id: "probe", label: "Ether probe", kind: "count", price: "probePrice", max: "maxProbes", blurb: "Flies a course and reports every sector it passes, until fighters shoot it down." },
  { id: "photon", label: "Photon missile", kind: "count", price: "photonPrice", max: "maxPhotons", blurb: "Knocks out fighters and weak planet defenses in a neighboring sector for a few minutes." },
  { id: "cloak", label: "Cloaking device", kind: "count", price: "cloakPrice", max: "maxCloaks", blurb: "Hides your parked ship from everyone until you next act. Can fail overnight." },
  { id: "corbomite", label: "Corbomite", kind: "count", price: "corbomitePrice", max: "maxCorbomite", blurb: "Units of retaliatory charge that hit whoever destroys your ship." },
  { id: "disruptor", label: "Mine disruptor", kind: "count", price: "disruptorPrice", max: "maxDisruptors", blurb: "Clears enemy mines here or next door." },
  { id: "detonator", label: "Atomic detonator", kind: "count", price: "detonatorPrice", max: "maxDetonators", blurb: "Destroys a planet you've landed on. Costs alignment." },
  { id: "beacon", label: "Marker beacon", kind: "count", price: "beaconPrice", max: "maxBeacons", blurb: "Leaves a message in a sector for anyone who arrives." },
];

export const gearDef = (id: string) => GEAR.find((g) => g.id === id);
