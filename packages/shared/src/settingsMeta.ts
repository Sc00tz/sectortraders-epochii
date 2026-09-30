import { DEFAULT_SETTINGS, type GameSettings } from "./settings";
import { SHIP_TYPES } from "./ships";
import { COMMODITIES, COMMODITY_LABEL, type Commodity } from "./commodities";

/**
 * How the admin panel shows and checks each setting.
 * - kind "pct" is stored as a fraction (0.25) and shown as a percentage (25).
 * - `creation` settings only matter when a galaxy is made; they're read-only for an existing galaxy.
 */
export type SettingKind = "int" | "num" | "pct" | "bool" | "ship";

export interface SettingMeta {
  key: string; // a GameSettings key, or "commodityBasePrice.ore", "shipPrices.battleship"
  label: string;
  group: string;
  kind: SettingKind;
  min?: number;
  max?: number;
  help?: string;
  creation?: boolean;
  /** When a change takes effect, if not immediately. */
  when?: string;
}

const G = {
  galaxy: "Galaxy (set at creation)",
  start: "Turns and new players",
  economy: "Ports and prices",
  haggle: "Haggling",
  hardware: "Hardware",
  ships: "Shipyard",
  combat: "Combat and deployables",
  planets: "Planets and citadels",
  corps: "Corporations",
  gear: "Equipment",
  crime: "Stealing, robbing, and taxes",
  office: "Commissions, bounties, and port upgrades",
  tavern: "The tavern",
  npcs: "NPCs",
} as const;
export const SETTING_GROUPS = Object.values(G);

const RESET = "at the next daily reset";

export const SETTINGS_META: SettingMeta[] = [
  { key: "sectors", label: "Sectors", group: G.galaxy, kind: "int", min: 100, max: 30000, creation: true },
  { key: "fedspaceSectors", label: "Core Space sectors", group: G.galaxy, kind: "int", min: 1, max: 100, creation: true, help: "Sectors 1 to this number are protected." },
  { key: "portDensity", label: "Port density", group: G.galaxy, kind: "pct", min: 5, max: 90, creation: true, help: "Share of sectors with a port." },
  { key: "portsBuiltPct", label: "Ports built at start", group: G.galaxy, kind: "pct", min: 10, max: 100, creation: true },
  { key: "twoWayWarpDensity", label: "Extra two-way warps", group: G.galaxy, kind: "pct", min: 0, max: 200, creation: true, help: "Beyond the minimum that connects every sector, as a share of sectors." },
  { key: "oneWayWarpDensity", label: "One-way warps", group: G.galaxy, kind: "pct", min: 0, max: 50, creation: true },
  { key: "maxWarpsPerSector", label: "Max warps per sector", group: G.galaxy, kind: "int", min: 2, max: 6, creation: true },
  { key: "portMaxStockMin", label: "Port stock, smallest", group: G.galaxy, kind: "int", min: 100, max: 100000, creation: true },
  { key: "portMaxStockMax", label: "Port stock, largest", group: G.galaxy, kind: "int", min: 100, max: 100000, creation: true },
  { key: "bigBangPlanetPct", label: "Unowned planets at start", group: G.galaxy, kind: "pct", min: 0, max: 20, creation: true, help: "Share of sectors." },
  { key: "colonistsStart", label: "Cradle colonists at start", group: G.galaxy, kind: "int", min: 0, max: 10000000, creation: true },
  { key: "seed", label: "Seed", group: G.galaxy, kind: "int", min: 0, max: 2147483647, creation: true, help: "0 picks a random one. The same seed and settings make the same galaxy." },

  { key: "turnsPerDay", label: "Turns per day", group: G.start, kind: "int", min: 10, max: 100000, when: RESET },
  { key: "maxPlayers", label: "Max traders", group: G.start, kind: "int", min: 1, max: 10000 },
  { key: "startingCredits", label: "Starting credits", group: G.start, kind: "int", min: 0, max: 100000000, when: "to traders who join after this" },
  { key: "startingHolds", label: "Starting holds", group: G.start, kind: "int", min: 1, max: 250, when: "to traders who join after this" },
  { key: "startingFighters", label: "Starting fighters", group: G.start, kind: "int", min: 0, max: 10000, when: "to traders who join after this" },
  { key: "startingShip", label: "Starting ship", group: G.start, kind: "ship", when: "to traders who join after this" },
  { key: "maxCourseLength", label: "Longest plotted course", group: G.start, kind: "int", min: 10, max: 1000, help: "In jumps." },
  { key: "inactiveDays", label: "Remove inactive traders after (days)", group: G.start, kind: "int", min: 0, max: 365, when: RESET, help: "0 keeps them forever. Their fighters, mines and beacons go; their planets pass to their corporation, or become unowned." },

  ...COMMODITIES.map((c: Commodity): SettingMeta => ({ key: `commodityBasePrice.${c}`, label: `${COMMODITY_LABEL[c]} base price`, group: G.economy, kind: "int", min: 1, max: 100000 })),
  { key: "portRegenPct", label: "Port restock per day", group: G.economy, kind: "pct", min: 0, max: 100, when: RESET, help: "Share of each port's capacity restored." },
  { key: "portPriceSpread", label: "Price spread between ports", group: G.galaxy, kind: "pct", min: 0, max: 50, creation: true, help: "Each port's prices vary by up to this much." },
  { key: "portDockTurns", label: "Turns to dock", group: G.economy, kind: "int", min: 0, max: 50 },

  { key: "haggleRoomMin", label: "Haggle room, new trader", group: G.haggle, kind: "pct", min: 0, max: 50, help: "Hidden discount a 0 XP trader can find." },
  { key: "haggleRoomMax", label: "Haggle room, veteran", group: G.haggle, kind: "pct", min: 0, max: 50 },
  { key: "haggleXpCap", label: "XP where haggle room tops out", group: G.haggle, kind: "int", min: 1, max: 1000000 },
  { key: "haggleMaxRounds", label: "Haggle rounds", group: G.haggle, kind: "int", min: 1, max: 10 },
  { key: "haggleMaxXp", label: "XP for a perfect haggle", group: G.haggle, kind: "int", min: 0, max: 1000 },
  { key: "haggleShiftPct", label: "Price shift on an overbid", group: G.haggle, kind: "pct", min: 0, max: 100 },

  { key: "fighterPrice", label: "Fighter price", group: G.hardware, kind: "int", min: 1, max: 1000000 },
  { key: "shieldPrice", label: "Shield point price", group: G.hardware, kind: "int", min: 1, max: 1000000 },
  { key: "holdPriceBase", label: "Cargo hold base price", group: G.hardware, kind: "int", min: 1, max: 1000000 },
  { key: "holdPriceStep", label: "Extra per hold already owned", group: G.hardware, kind: "int", min: 0, max: 100000 },
  { key: "armidPrice", label: "Burst mine price", group: G.hardware, kind: "int", min: 1, max: 1000000 },
  { key: "limpetPrice", label: "Limpet mine price", group: G.hardware, kind: "int", min: 1, max: 1000000 },
  { key: "maxMinesCarried", label: "Mines carried (each type)", group: G.hardware, kind: "int", min: 0, max: 10000 },
  { key: "maxMinesPerSector", label: "Mines per sector (each type)", group: G.hardware, kind: "int", min: 0, max: 10000 },
  { key: "limpetRemovalPrice", label: "Limpet removal price", group: G.hardware, kind: "int", min: 0, max: 10000000 },
  { key: "genesisPrice", label: "Genesis torpedo price", group: G.hardware, kind: "int", min: 1, max: 100000000 },
  { key: "maxGenesisCarried", label: "Genesis torpedoes carried", group: G.hardware, kind: "int", min: 0, max: 100 },

  { key: "shipTradeInPct", label: "Trade-in value", group: G.ships, kind: "pct", min: 0, max: 100 },
  ...Object.values(SHIP_TYPES).filter((t) => t.buyable).map((t): SettingMeta => ({ key: `shipPrices.${t.id}`, label: `${t.name}`, group: G.ships, kind: "int", min: 0, max: 100000000 })),

  { key: "attackTurns", label: "Turns per attack", group: G.combat, kind: "int", min: 0, max: 50 },
  { key: "shieldOdds", label: "Fighters absorbed per shield point", group: G.combat, kind: "num", min: 0.1, max: 100 },
  { key: "sectorFighterOdds", label: "Deployed fighter odds", group: G.combat, kind: "num", min: 0.1, max: 10 },
  { key: "offensiveCommitFactor", label: "Offensive fighter commitment", group: G.combat, kind: "num", min: 0.1, max: 10, help: "Times the target ship's max fighters plus shields." },
  { key: "tollPerFighter", label: "Toll per fighter", group: G.combat, kind: "int", min: 0, max: 100000 },
  { key: "armidTriggerChance", label: "Burst mine trigger chance", group: G.combat, kind: "pct", min: 0, max: 100 },
  { key: "armidDamage", label: "Damage per burst mine", group: G.combat, kind: "int", min: 0, max: 100000 },
  { key: "minesCanDestroy", label: "Mines can destroy ships", group: G.combat, kind: "bool" },
  { key: "fedMaxXp", label: "Core Space protection: under this XP", group: G.combat, kind: "int", min: 0, max: 100000000 },
  { key: "fedMaxFighters", label: "Core Space protection: under this many fighters", group: G.combat, kind: "int", min: 0, max: 1000000 },
  { key: "killXpBase", label: "XP for a kill", group: G.combat, kind: "int", min: 0, max: 1000000 },
  { key: "killAlignment", label: "Alignment change for a kill", group: G.combat, kind: "int", min: 0, max: 100000 },

  { key: "maxPlanetsPerSector", label: "Planets per sector", group: G.planets, kind: "int", min: 1, max: 20 },
  { key: "landTurns", label: "Turns to land", group: G.planets, kind: "int", min: 0, max: 50 },
  { key: "genesisTurns", label: "Turns to launch Genesis", group: G.planets, kind: "int", min: 0, max: 50 },
  { key: "colonistsMax", label: "Cradle colonist cap", group: G.planets, kind: "int", min: 0, max: 10000000 },
  { key: "colonistsRegen", label: "Cradle colonists per day", group: G.planets, kind: "int", min: 0, max: 10000000, when: RESET },
  { key: "treasuryInterestPct", label: "Planet treasury interest per day", group: G.planets, kind: "pct", min: 0, max: 50, when: RESET },
  { key: "planetBaseOdds", label: "Planet fighter odds, no combat computer", group: G.planets, kind: "num", min: 0.1, max: 20 },
  { key: "planetOffensiveOdds", label: "Planet fighter odds, attacking", group: G.planets, kind: "num", min: 0.1, max: 20 },
  { key: "planetDefensiveOdds", label: "Planet fighter odds, defending", group: G.planets, kind: "num", min: 0.1, max: 20 },
  { key: "planetShieldOdds", label: "Fighters absorbed per planetary shield", group: G.planets, kind: "num", min: 0.1, max: 1000 },
  { key: "planetShieldConversion", label: "Ship shields per planetary shield", group: G.planets, kind: "num", min: 0.1, max: 1000 },
  { key: "qAtmoMultiplier", label: "Atmospheric Q-cannon multiplier", group: G.planets, kind: "num", min: 0, max: 10 },
  { key: "planetWarpOrePerSector", label: "Planet TransWarp ore per sector", group: G.planets, kind: "int", min: 0, max: 100000 },
  { key: "interdictorOre", label: "Interdictor ore per use", group: G.planets, kind: "int", min: 0, max: 100000 },

  { key: "transwarpPrice", label: "TransWarp drive price", group: G.gear, kind: "int", min: 0, max: 100000000, help: "Only hulls built for TransWarp can take one." },
  { key: "transwarpTurns", label: "Turns per TransWarp jump", group: G.gear, kind: "int", min: 0, max: 100 },
  { key: "transwarpOrePerSector", label: "Fuel Ore per sector jumped", group: G.gear, kind: "int", min: 0, max: 1000 },
  { key: "densityScannerPrice", label: "Density scanner price", group: G.gear, kind: "int", min: 0, max: 100000000 },
  { key: "holoScannerPrice", label: "Holo scanner price", group: G.gear, kind: "int", min: 0, max: 100000000 },
  { key: "holoScanTurns", label: "Turns per holo scan", group: G.gear, kind: "int", min: 0, max: 100 },
  { key: "planetScannerPrice", label: "Planet scanner price", group: G.gear, kind: "int", min: 0, max: 100000000 },
  { key: "probePrice", label: "Ether probe price", group: G.gear, kind: "int", min: 0, max: 100000000 },
  { key: "maxProbes", label: "Ether probes carried", group: G.gear, kind: "int", min: 0, max: 1000 },
  { key: "photonPrice", label: "Photon missile price", group: G.gear, kind: "int", min: 0, max: 100000000 },
  { key: "maxPhotons", label: "Photon missiles carried", group: G.gear, kind: "int", min: 0, max: 100 },
  { key: "photonSeconds", label: "Photon wave duration", group: G.gear, kind: "int", min: 10, max: 86400, help: "Seconds that fighters and planet defenses in the target sector stay disabled." },
  { key: "photonPlanetShieldLimit", label: "Planet shields that block photons", group: G.gear, kind: "int", min: 0, max: 1000000, help: "Planets with at least this many shields keep firing." },
  { key: "cloakPrice", label: "Cloaking device price", group: G.gear, kind: "int", min: 0, max: 100000000 },
  { key: "maxCloaks", label: "Cloaking devices carried", group: G.gear, kind: "int", min: 0, max: 100 },
  { key: "cloakFailPct", label: "Cloak failure chance per day", group: G.gear, kind: "pct", min: 0, max: 100 },
  { key: "corbomitePrice", label: "Corbomite price per unit", group: G.gear, kind: "int", min: 0, max: 10000000 },
  { key: "maxCorbomite", label: "Corbomite units carried", group: G.gear, kind: "int", min: 0, max: 100000 },
  { key: "corbomiteDamage", label: "Corbomite damage per unit", group: G.gear, kind: "int", min: 0, max: 10000, help: "Dealt to whoever destroys your ship." },
  { key: "disruptorPrice", label: "Mine disruptor price", group: G.gear, kind: "int", min: 0, max: 100000000 },
  { key: "maxDisruptors", label: "Mine disruptors carried", group: G.gear, kind: "int", min: 0, max: 100 },
  { key: "disruptorMines", label: "Mines cleared per disruptor", group: G.gear, kind: "int", min: 1, max: 1000 },
  { key: "detonatorPrice", label: "Atomic detonator price", group: G.gear, kind: "int", min: 0, max: 100000000 },
  { key: "maxDetonators", label: "Atomic detonators carried", group: G.gear, kind: "int", min: 0, max: 100 },
  { key: "detonatorAlignment", label: "Alignment change for detonating a planet", group: G.gear, kind: "int", min: -100000, max: 0 },
  { key: "beaconPrice", label: "Marker beacon price", group: G.gear, kind: "int", min: 0, max: 10000000 },
  { key: "maxBeacons", label: "Marker beacons carried", group: G.gear, kind: "int", min: 0, max: 1000 },

  { key: "thiefAlignment", label: "Alignment needed to steal and rob", group: G.crime, kind: "int", min: -100000, max: 0, help: "At or below." },
  { key: "stealHoldsPerXp", label: "Holds you can steal per XP", group: G.crime, kind: "num", min: 0, max: 10 },
  { key: "robCreditsPerXp", label: "Credits you can rob per XP", group: G.crime, kind: "num", min: 0, max: 10000 },
  { key: "crimeTurns", label: "Turns per steal or robbery", group: G.crime, kind: "int", min: 0, max: 100 },
  { key: "crimeBustBase", label: "Chance of getting caught", group: G.crime, kind: "pct", min: 0, max: 100 },
  { key: "crimeBustHeat", label: "Extra chance per crime at that port today", group: G.crime, kind: "pct", min: 0, max: 100 },
  { key: "crimeAlignment", label: "Alignment change per crime", group: G.crime, kind: "int", min: -100000, max: 0 },
  { key: "bustXpLossPct", label: "Experience lost when caught", group: G.crime, kind: "pct", min: 0, max: 100 },
  { key: "bustHoldsLossPct", label: "Cargo holds confiscated when caught", group: G.crime, kind: "pct", min: 0, max: 100 },
  { key: "bustDays", label: "Days a port refuses you after a bust", group: G.crime, kind: "int", min: 0, max: 365 },
  { key: "taxesEnabled", label: "Taxes on good traders", group: G.crime, kind: "bool" },
  { key: "taxThreshold", label: "Taxed above this many credits", group: G.crime, kind: "int", min: 0, max: 1000000000, when: "at the next daily reset" },
  { key: "taxPct", label: "Tax rate", group: G.crime, kind: "pct", min: 0, max: 100, when: "at the next daily reset" },
  { key: "taxCreditsPerAlignment", label: "Tax credits per alignment point earned", group: G.crime, kind: "int", min: 1, max: 1000000 },

  { key: "commissionAlignment", label: "Alignment to request a commission", group: G.office, kind: "int", min: 0, max: 100000 },
  { key: "commissionGrant", label: "Alignment a commission raises you to", group: G.office, kind: "int", min: 0, max: 100000, help: "The Warden needs 1,000." },
  { key: "bountyMin", label: "Smallest bounty", group: G.office, kind: "int", min: 1, max: 100000000 },
  { key: "bountyCreditsPerAlignment", label: "Bounty credits per alignment point earned", group: G.office, kind: "int", min: 1, max: 10000000 },
  { key: "portUpgradeCostPerUnit", label: "Port upgrade price per unit of capacity", group: G.office, kind: "int", min: 1, max: 100000 },
  { key: "portUpgradeCreditsPerAlignment", label: "Upgrade credits per alignment point earned", group: G.office, kind: "int", min: 1, max: 10000000 },
  { key: "portMaxCapacity", label: "Largest a port's stock can grow", group: G.office, kind: "int", min: 100, max: 10000000 },

  { key: "tavernPostPrice", label: "Price of a tavern board notice", group: G.tavern, kind: "int", min: 0, max: 10000000 },
  { key: "tavernRumorPrice", label: "Price of a rumor", group: G.tavern, kind: "int", min: 0, max: 10000000 },
  { key: "tavernTracePrice", label: "Price to learn where a trader was seen", group: G.tavern, kind: "int", min: 0, max: 100000000 },

  { key: "maxCorpMembers", label: "Traders per corporation", group: G.corps, kind: "int", min: 2, max: 100, help: "Lowering it doesn't remove anyone; full corps just can't add members." },

  { key: "npcsEnabled", label: "NPCs active", group: G.npcs, kind: "bool", help: "Off freezes them in place; they don't disappear." },
  { key: "npcMoveChance", label: "Chance an NPC moves each minute", group: G.npcs, kind: "pct", min: 0, max: 100 },
  { key: "authorityCaptains", label: "Authority captains", group: G.npcs, kind: "int", min: 0, max: 4, help: "Captains past this number stay where they are; new ones appear within a minute." },
  { key: "authorityFighters", label: "Authority captain fighters", group: G.npcs, kind: "int", min: 0, max: 1000000 },
  { key: "authorityHostileAlignment", label: "Authority attacks at alignment of", group: G.npcs, kind: "int", min: -100000, max: 0, help: "Or lower, in Core Space." },
  { key: "mawRaiders", label: "Maw raiders", group: G.npcs, kind: "int", min: 0, max: 100, when: RESET, help: "0 scales with galaxy size." },
  { key: "mawRaiderFighters", label: "Fighters per raider", group: G.npcs, kind: "int", min: 1, max: 100000, when: "to raiders launched after this" },
  { key: "mawAggression", label: "Maw aggression", group: G.npcs, kind: "pct", min: 0, max: 100, help: "Chance a raider attacks a target it expects to beat." },
  { key: "mawSparesNewbies", label: "Raiders leave new pilots alone", group: G.npcs, kind: "bool", help: "Pilots who'd qualify for Core Space protection." },
  { key: "mawLootPct", label: "Credits a raider takes", group: G.npcs, kind: "pct", min: 0, max: 100 },
  { key: "mawRegenPct", label: "Maw fighter regrowth per day", group: G.npcs, kind: "pct", min: 0, max: 100, when: RESET, help: "Share of the cap." },
  { key: "mawFighterCap", label: "Maw home fighter cap", group: G.npcs, kind: "int", min: 0, max: 1000000, when: RESET },
  { key: "mawStartFighters", label: "Maw starting fighters", group: G.npcs, kind: "int", min: 0, max: 1000000, help: "Only used when the Maw first appear in a galaxy." },
  { key: "mawStartCredits", label: "Maw starting vault", group: G.npcs, kind: "int", min: 0, max: 100000000, help: "Only used when the Maw first appear in a galaxy." },
  { key: "veyTraders", label: "Vey ships", group: G.npcs, kind: "int", min: 0, max: 100, when: RESET, help: "0 scales with galaxy size." },
  { key: "veyEvilPct", label: "Share of Vey that turn raider", group: G.npcs, kind: "pct", min: 0, max: 100, when: "to Vey that appear after this" },
  { key: "veyAggression", label: "Hostile Vey aggression", group: G.npcs, kind: "pct", min: 0, max: 100 },
];

/** Rules that involve two settings. Returns a problem, or null. */
export function crossCheckSettings(s: GameSettings): string | null {
  if (s.haggleRoomMin > s.haggleRoomMax) return "Haggle room for a new trader can't be more than for a veteran";
  if (s.portMaxStockMin > s.portMaxStockMax) return "Smallest port stock can't be more than the largest";
  if (s.fedspaceSectors >= s.sectors) return "Core Space can't cover the whole galaxy";
  return null;
}

/** Read a (possibly dotted) setting. */
export function getSetting(s: GameSettings, key: string): number | boolean | string {
  const [a, b] = key.split(".");
  const v = (s as unknown as Record<string, unknown>)[a!];
  return (b ? (v as Record<string, unknown>)?.[b] : v) as number | boolean | string;
}

/** The default for a setting. */
export const defaultSetting = (key: string) => getSetting(DEFAULT_SETTINGS, key);

/**
 * Check a patch of `{ key: value }` (pct values as fractions) and return it as a partial GameSettings,
 * or throw with a readable message. `creating` allows creation-only keys.
 */
export function validateSettingsPatch(patch: Record<string, unknown>, creating: boolean): Partial<GameSettings> {
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(patch)) {
    const meta = SETTINGS_META.find((m) => m.key === key);
    if (!meta) throw new Error(`Unknown setting: ${key}`);
    if (meta.creation && !creating) throw new Error(`${meta.label} can only be set when a galaxy is created`);
    let value: unknown = raw;
    if (meta.kind === "bool") {
      if (typeof raw !== "boolean") throw new Error(`${meta.label} must be on or off`);
    } else if (meta.kind === "ship") {
      const t = SHIP_TYPES[String(raw)];
      if (!t || !t.buyable || t.requires) throw new Error(`${meta.label} must be a regular buyable ship`);
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new Error(`${meta.label} must be a number`);
      const shown = meta.kind === "pct" ? n * 100 : n;
      if (meta.kind === "int" && !Number.isInteger(n)) throw new Error(`${meta.label} must be a whole number`);
      if ((meta.min != null && shown < meta.min - 1e-9) || (meta.max != null && shown > meta.max + 1e-9)) {
        throw new Error(`${meta.label} must be between ${meta.min} and ${meta.max}${meta.kind === "pct" ? "%" : ""}`);
      }
      value = n;
    }
    const [a, b] = key.split(".");
    if (b) out[a!] = { ...(out[a!] as object ?? {}), [b]: value };
    else out[a!] = value;
  }
  return out as Partial<GameSettings>;
}
