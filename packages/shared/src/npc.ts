import { resolveCombat } from "./combat";
import type { Rng } from "./random";

/** The three NPC factions and the parts they play. Names are ours (spec: all NPC names original). */
export type NpcFaction = "authority" | "maw" | "vey";
export type NpcRole = "captain" | "warlord" | "raider" | "trader";

export const FACTIONS: Record<NpcFaction, { name: string; short: string; emblem: string; blurb: string }> = {
  authority: { name: "The Sector Authority", short: "Authority", emblem: "emblem_federation", blurb: "Police of the protected core sectors. Their captains can't be destroyed, and they hunt evil-aligned pilots in their space." },
  maw: { name: "The Maw", short: "Maw", emblem: "emblem_pirates", blurb: "Raiders out of a hidden home base. They prey on anyone they think they can beat and carry off what they take." },
  vey: { name: "The Vey", short: "Vey", emblem: "emblem_aliens", blurb: "Wandering alien traders. Most keep to business; some turn raider when the odds look good." },
};

export const AUTHORITY_CAPTAINS = [
  { alias: "Captain Ilse Marrow", portrait: "portrait_fed_captain_1" },
  { alias: "Admiral Josiah Kade", portrait: "portrait_fed_captain_2" },
  { alias: "Commander Dante Solari", portrait: "portrait_fed_captain_3" },
  { alias: "Fleet Admiral Scooter", portrait: "portrait_authority_captain_4" },
] as const;

export const MAW_WARLORD = { alias: "Warlord Skarn", portrait: "portrait_pirate_leader" } as const;

const RAIDER_NAMES = ["Rend", "Hookjaw", "Sallow", "Brine", "Kess", "Rattle", "Grit", "Cutter", "Snarl", "Husk", "Gnaw", "Scald", "Tusk", "Blister", "Mange", "Sprocket", "Rivet", "Cinder", "Lash", "Grub"];
const VEY_START = ["Ss", "Or", "Ith", "Vael", "Ush", "Qir", "Tho", "Ael", "Nym", "Esh", "Yr", "Cael"];
const VEY_MID = ["a", "e", "i", "ou", "ae", "y"];
const VEY_END = ["thi", "vai", "ren", "sk", "lune", "mir", "sha", "tor", "quel", "nix", "ven", "rhe"];

export function raiderName(rng: Rng) { return `${rng.pick(RAIDER_NAMES)} of the Maw`; }
export function veyName(rng: Rng) { return `${rng.pick(VEY_START)}${rng.pick(VEY_MID)}${rng.pick(VEY_END)} of the Vey`; }

/** Vey hulls: peaceful traders fly couriers or haulers, the ones turned raider fly warships. */
export const VEY_TRADER_HULLS = ["vey_courier", "vey_hauler"] as const;
export const VEY_TRADER_HULL = "vey_hauler";
export const VEY_RAIDER_HULL = "vey_warship";
export const VEY_PORTRAIT = "portrait_vey_envoy";
export const MAW_RAIDER_PORTRAIT = "portrait_maw_raider";

export function raiderCount(s: { mawRaiders: number; sectors: number }) {
  return s.mawRaiders > 0 ? s.mawRaiders : Math.max(2, Math.min(20, Math.round(s.sectors / 200)));
}
export function veyCount(s: { veyTraders: number; sectors: number }) {
  return s.veyTraders > 0 ? s.veyTraders : Math.max(3, Math.min(25, Math.round(s.sectors / 150)));
}

/** Would an all-out attack destroy the target? NPCs only pick fights they expect to win. */
export function wouldDestroy(att: { fighters: number; odds: number }, def: { fighters: number; odds: number; shields: number }, shieldOdds: number) {
  return resolveCombat({ attFighters: att.fighters, attOdds: att.odds, defFighters: def.fighters, defOdds: def.odds, defShields: def.shields, shieldOdds }).destroyed;
}
