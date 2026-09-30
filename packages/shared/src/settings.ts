import type { Commodity } from "./commodities";

/**
 * Every tunable from the design spec lives here. A game stores its own copy
 * (defaults merged with admin overrides) so rules can differ per game.
 * Values marked "unverified" are not documented for TW2002 v3 and are starting
 * points for playtesting.
 */
export interface GameSettings {
  // Universe (Big Bang)
  sectors: number;
  fedspaceSectors: number;
  portDensity: number; // share of sectors that get a port
  portsBuiltPct: number; // share of possible ports built at start
  twoWayWarpDensity: number; // extra two-way warps beyond a spanning tree, as a share of sectors
  oneWayWarpDensity: number;
  maxWarpsPerSector: number;
  maxCourseLength: number;
  inactiveDays: number; // remove human traders unseen this many days, at the daily reset; 0 = never
  seed: number;
  maxPlayers: number;

  // Turns and start-up
  turnsPerDay: number; // unverified default
  startingCredits: number; // unverified default
  startingHolds: number;
  startingFighters: number;
  startingShip: string;

  // Economy
  commodityBasePrice: Record<Commodity, number>; // unverified defaults
  portMaxStockMin: number; // unverified
  portMaxStockMax: number; // unverified
  portRegenPct: number; // share of max restored per daily reset, unverified
  portPriceSpread: number; // per-port random price factor, +/- this share
  portDockTurns: number;

  // Haggling
  haggleRoomMin: number; // hidden discount room for a 0 XP trader
  haggleRoomMax: number; // room for a trader at haggleXpCap XP
  haggleXpCap: number; // spec: prices plateau around 1,000 XP
  haggleMaxRounds: number;
  haggleMaxXp: number; // XP for a perfect haggle (spec: about 5)
  haggleShiftPct: number; // how far the port's best price moves against you on an overbid (spec: 30%)

  // Hardware (special depots and Stardock). All unverified for v3.
  fighterPrice: number;
  shieldPrice: number;
  holdPriceBase: number; // price of the next hold = base + step x holds you already have
  holdPriceStep: number;
  armidPrice: number;
  limpetPrice: number;
  maxMinesCarried: number; // per mine type, any ship
  maxMinesPerSector: number; // spec: 99
  limpetRemovalPrice: number;

  // Shipyard
  shipPrices: Record<string, number>; // 1993 Bible prices where known
  shipTradeInPct: number; // share of the old ship's price credited on trade-in

  // Combat and deployables
  attackTurns: number;
  shieldOdds: number; // spec: ship shields fight at 2:1
  sectorFighterOdds: number; // spec: deployed fighters fight at 1:1
  offensiveCommitFactor: number; // spec: offensive fighters commit 1.25 x (max shields + max fighters)
  tollPerFighter: number; // unverified
  armidTriggerChance: number; // spec: 50%
  armidDamage: number; // per detonating mine, unverified
  minesCanDestroy: boolean; // our choice: mines strip shields and fighters but leave the hull
  fedMaxXp: number; // FedSpace protection: under this XP...
  fedMaxFighters: number; // ...under this many fighters, and alignment >= 0
  killXpBase: number; // flat XP for destroying a ship, unverified
  killAlignment: number; // alignment change for destroying a ship, unverified

  // Planets and citadels
  genesisPrice: number; // 1993 Bible
  maxGenesisCarried: number; // ours
  maxPlanetsPerSector: number; // Bible: "typically 5"
  bigBangPlanetPct: number; // unowned planets seeded at creation, share of sectors (ours)
  landTurns: number;
  genesisTurns: number;
  colonistsStart: number; // home world colonist pool at creation (ours)
  colonistsMax: number;
  colonistsRegen: number; // per day; TWGS guide: 750
  treasuryInterestPct: number; // spec: 2% per day
  planetBaseOdds: number; // planet fighters before a Combat Control Computer (ours)
  planetOffensiveOdds: number; // spec: 2:1 with level 2
  planetDefensiveOdds: number; // spec: 3:1 with level 2
  planetShieldOdds: number; // spec: planetary shields fight at 20:1
  planetShieldConversion: number; // spec: 10 ship shields per planetary shield
  qAtmoMultiplier: number; // spec: 0.5 or 2 depending on version
  planetWarpOrePerSector: number; // spec: 400
  interdictorOre: number; // spec: 500 per attempt

  maxCorpMembers: number; // spec: 5 by default, admin-tunable

  // Equipment sold at Keystone Station. Bible prices where the spec has them; the rest are ours.
  transwarpPrice: number; // Bible: 50,000
  transwarpTurns: number; // spec: 1 turn regardless of distance
  transwarpOrePerSector: number; // spec: 3 Fuel Ore per sector jumped
  densityScannerPrice: number; // ours
  holoScannerPrice: number; // ours
  holoScanTurns: number; // spec: 1
  planetScannerPrice: number; // ours (not documented)
  probePrice: number; // ours
  maxProbes: number; // Bible: 25
  photonPrice: number; // TWGS settings page: 160,000
  maxPhotons: number; // ours
  photonSeconds: number; // how long a photon wave disables fighters and planet defenses (ours)
  photonPlanetShieldLimit: number; // spec: planets at or above this many shields shrug off photons
  cloakPrice: number; // Bible: 25,000
  maxCloaks: number; // Bible: 5
  cloakFailPct: number; // chance a cloak fails at each daily reset (spec gives 3% for aliens)
  corbomitePrice: number; // per unit; Bible: about 150,000 for 1,500
  maxCorbomite: number; // Bible: 1,500
  corbomiteDamage: number; // damage to your killer per unit (ours; the math isn't documented)
  disruptorPrice: number; // ours
  maxDisruptors: number; // Bible: 10
  disruptorMines: number; // Bible: clears up to 12 mines
  detonatorPrice: number; // ours (not documented)
  maxDetonators: number; // Bible: 5
  detonatorAlignment: number; // spec: -50
  beaconPrice: number; // ours
  maxBeacons: number; // ours

  // Stealing and robbing (the evil path)
  thiefAlignment: number; // spec: -100 or lower to steal and rob
  stealHoldsPerXp: number; // spec: holds you can steal = experience / 20
  robCreditsPerXp: number; // spec: credits you can rob = experience x 10
  crimeTurns: number; // ours
  crimeBustBase: number; // base chance of getting caught (ours)
  crimeBustHeat: number; // extra chance per crime at that port today (ours)
  crimeAlignment: number; // alignment lost per successful crime (ours)
  bustXpLossPct: number; // spec: 10% of experience
  bustHoldsLossPct: number; // share of cargo holds confiscated when caught (ours; spec says "costs holds")
  bustDays: number; // spec: the port refuses you for 14 days

  // Authority office and port upgrades
  commissionAlignment: number; // spec: request a commission at 500 alignment...
  commissionGrant: number; // ...and alignment is raised to 1,000
  bountyMin: number; // ours
  bountyCreditsPerAlignment: number; // spec: posting a bounty buys alignment at about 1,000 credits a point
  portUpgradeCostPerUnit: number; // credits per unit of added capacity (ours)
  portUpgradeCreditsPerAlignment: number; // spec: upgrading ports buys alignment at about 5,000 credits a point
  portMaxCapacity: number; // ours: no slot grows past this

  // Communications and the tavern
  tavernPostPrice: number; // spec: 100 credits per announcement
  tavernRumorPrice: number; // ours
  tavernTracePrice: number; // ours: what the keeper charges to say where a trader was last seen

  // Taxes
  taxesEnabled: boolean;
  taxThreshold: number; // spec: good players holding more than 49,999 credits at day start
  taxPct: number; // spec: lose 10%
  taxCreditsPerAlignment: number; // spec: paying taxes buys alignment at about 1,500 credits a point

  // NPCs. Figures marked "spec" come from the design spec; the rest are ours, for playtesting.
  npcsEnabled: boolean;
  npcMoveChance: number; // chance each NPC moves on a tick (the worker ticks once a minute)
  authorityCaptains: number; // spec: three; we have four
  authorityFighters: number; // captains are indestructible and re-arm every tick
  authorityHostileAlignment: number; // captains attack players at or below this alignment in FedSpace
  mawStartFighters: number; // spec: 5,000 in the home treasury
  mawStartCredits: number; // spec: 100,000
  mawRegenPct: number; // spec: 20% per day toward the cap
  mawFighterCap: number;
  mawRaiders: number; // 0 = scale with galaxy size
  mawRaiderFighters: number; // drawn from the treasury per raider
  mawAggression: number; // chance a raider attacks a target it thinks it can beat
  mawLootPct: number; // share of a victim's credits a raider takes
  mawSparesNewbies: boolean; // raiders leave players who'd qualify for Authority protection alone
  veyTraders: number; // 0 = scale with galaxy size
  veyEvilPct: number; // share of Vey ships that are hostile
  veyAggression: number; // chance a hostile Vey attacks a target it thinks it can beat
}

export const DEFAULT_SETTINGS: GameSettings = {
  sectors: 1000,
  fedspaceSectors: 10,
  portDensity: 0.4,
  portsBuiltPct: 0.95,
  twoWayWarpDensity: 0.3,
  oneWayWarpDensity: 0.03,
  maxWarpsPerSector: 6,
  maxCourseLength: 100,
  inactiveDays: 30,
  seed: 0, // 0 = pick a random seed at creation
  maxPlayers: 200,

  turnsPerDay: 500,
  startingCredits: 20000,
  startingHolds: 20,
  startingFighters: 30,
  startingShip: "merchant_cruiser",

  commodityBasePrice: { ore: 22, org: 36, equ: 58 },
  portMaxStockMin: 1000,
  portMaxStockMax: 3000,
  portRegenPct: 0.1,
  portPriceSpread: 0.1,
  portDockTurns: 1,

  haggleRoomMin: 0.03,
  haggleRoomMax: 0.1,
  haggleXpCap: 1000,
  haggleMaxRounds: 3,
  haggleMaxXp: 5,
  haggleShiftPct: 0.3,

  fighterPrice: 150,
  shieldPrice: 100,
  holdPriceBase: 250,
  holdPriceStep: 5,
  armidPrice: 100,
  limpetPrice: 250,
  maxMinesCarried: 50,
  maxMinesPerSector: 99,
  limpetRemovalPrice: 5000,

  shipPrices: {
    merchant_cruiser: 26300, scout_marauder: 13200, missile_frigate: 28800, battleship: 40500,
    corporate_flagship: 71000, colonial_transport: 54400, cargotran: 59400, merchant_freighter: 36200,
    imperial_starship: 128600, havoc_gunstar: 29500, starmaster: 48000, constellation: 40500,
    tkhasi_orion: 36000, tholian_sentinel: 27000, taurean_mule: 53600,
    interdictor_cruiser: 150000, // not in the Bible; our placeholder for playtesting
  },
  shipTradeInPct: 0.5,

  attackTurns: 1,
  shieldOdds: 2,
  sectorFighterOdds: 1,
  offensiveCommitFactor: 1.25,
  tollPerFighter: 5,
  armidTriggerChance: 0.5,
  armidDamage: 50,
  minesCanDestroy: false,
  fedMaxXp: 1000,
  fedMaxFighters: 50,
  killXpBase: 25,
  killAlignment: 25,

  genesisPrice: 25000,
  maxGenesisCarried: 5,
  maxPlanetsPerSector: 5,
  bigBangPlanetPct: 0.03,
  landTurns: 1,
  genesisTurns: 1,
  colonistsStart: 100000,
  colonistsMax: 100000,
  colonistsRegen: 750,
  treasuryInterestPct: 0.02,
  planetBaseOdds: 1,
  planetOffensiveOdds: 2,
  planetDefensiveOdds: 3,
  planetShieldOdds: 20,
  planetShieldConversion: 10,
  qAtmoMultiplier: 0.5,
  planetWarpOrePerSector: 400,
  interdictorOre: 500,

  maxCorpMembers: 5,

  transwarpPrice: 50000,
  transwarpTurns: 1,
  transwarpOrePerSector: 3,
  densityScannerPrice: 2500,
  holoScannerPrice: 12000,
  holoScanTurns: 1,
  planetScannerPrice: 20000,
  probePrice: 3000,
  maxProbes: 25,
  photonPrice: 160000,
  maxPhotons: 3,
  photonSeconds: 300,
  photonPlanetShieldLimit: 200,
  cloakPrice: 25000,
  maxCloaks: 5,
  cloakFailPct: 0.03,
  corbomitePrice: 100,
  maxCorbomite: 1500,
  corbomiteDamage: 5,
  disruptorPrice: 6000,
  maxDisruptors: 10,
  disruptorMines: 12,
  detonatorPrice: 150000,
  maxDetonators: 5,
  detonatorAlignment: -50,
  beaconPrice: 500,
  maxBeacons: 10,

  thiefAlignment: -100,
  stealHoldsPerXp: 0.05,
  robCreditsPerXp: 10,
  crimeTurns: 1,
  crimeBustBase: 0.1,
  crimeBustHeat: 0.08,
  crimeAlignment: -5,
  bustXpLossPct: 0.1,
  bustHoldsLossPct: 0.1,
  bustDays: 14,

  commissionAlignment: 500,
  commissionGrant: 1000,
  bountyMin: 1000,
  bountyCreditsPerAlignment: 1000,
  portUpgradeCostPerUnit: 15,
  portUpgradeCreditsPerAlignment: 5000,
  portMaxCapacity: 30000,

  tavernPostPrice: 100,
  tavernRumorPrice: 2000,
  tavernTracePrice: 15000,

  taxesEnabled: true,
  taxThreshold: 49999,
  taxPct: 0.1,
  taxCreditsPerAlignment: 1500,

  npcsEnabled: true,
  npcMoveChance: 0.1,
  authorityCaptains: 4,
  authorityFighters: 3000,
  authorityHostileAlignment: -100,
  mawStartFighters: 5000,
  mawStartCredits: 100000,
  mawRegenPct: 0.2,
  mawFighterCap: 5000,
  mawRaiders: 0,
  mawRaiderFighters: 400,
  mawAggression: 0.5,
  mawLootPct: 0.25,
  mawSparesNewbies: true,
  veyTraders: 0,
  veyEvilPct: 0.35,
  veyAggression: 0.25,
};

export function resolveSettings(overrides: Partial<GameSettings> | null | undefined): GameSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...(overrides ?? {}),
    commodityBasePrice: { ...DEFAULT_SETTINGS.commodityBasePrice, ...(overrides?.commodityBasePrice ?? {}) },
    shipPrices: { ...DEFAULT_SETTINGS.shipPrices, ...(overrides?.shipPrices ?? {}) },
  };
}
