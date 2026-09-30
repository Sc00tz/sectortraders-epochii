/**
 * Ship stat blocks from the spec. Ids keep the TW2002 reference names (they're stored in the
 * database); display names are ours.
 */
export interface ShipType {
  id: string;
  name: string;
  turnsPerWarp: number;
  offensiveOdds: number;
  defensiveOdds: number;
  maxFighters: number;
  maxShields: number;
  maxHolds: number;
  transwarp: boolean;
  sprite: string | null; // null = drawn in code (escape pod)
  buyable: boolean;
  requires?: "commission" | "corporation";
  npc?: boolean; // flown only by NPCs
}

export const SHIP_TYPES: Record<string, ShipType> = {
  merchant_cruiser: { id: "merchant_cruiser", name: "Tradewind", turnsPerWarp: 3, offensiveOdds: 1.0, defensiveOdds: 1.0, maxFighters: 2500, maxShields: 400, maxHolds: 75, transwarp: false, sprite: "ship_merchant_cruiser", buyable: true },
  scout_marauder: { id: "scout_marauder", name: "Wasp", turnsPerWarp: 2, offensiveOdds: 2.0, defensiveOdds: 2.0, maxFighters: 250, maxShields: 100, maxHolds: 25, transwarp: false, sprite: "ship_scout_marauder", buyable: true },
  missile_frigate: { id: "missile_frigate", name: "Lancer", turnsPerWarp: 3, offensiveOdds: 1.3, defensiveOdds: 1.3, maxFighters: 5000, maxShields: 400, maxHolds: 60, transwarp: false, sprite: "ship_missile_frigate", buyable: true },
  battleship: { id: "battleship", name: "Bulwark", turnsPerWarp: 4, offensiveOdds: 1.6, defensiveOdds: 1.6, maxFighters: 10000, maxShields: 750, maxHolds: 80, transwarp: false, sprite: "ship_battleship", buyable: true },
  corporate_flagship: { id: "corporate_flagship", name: "Magnate", turnsPerWarp: 3, offensiveOdds: 1.2, defensiveOdds: 1.2, maxFighters: 20000, maxShields: 1500, maxHolds: 85, transwarp: true, sprite: "ship_corporate_flagship", buyable: true, requires: "corporation" },
  colonial_transport: { id: "colonial_transport", name: "Homesteader", turnsPerWarp: 6, offensiveOdds: 0.6, defensiveOdds: 0.6, maxFighters: 200, maxShields: 500, maxHolds: 250, transwarp: false, sprite: "ship_colonial_transport", buyable: true },
  cargotran: { id: "cargotran", name: "Longhaul", turnsPerWarp: 4, offensiveOdds: 0.8, defensiveOdds: 0.8, maxFighters: 400, maxShields: 1000, maxHolds: 125, transwarp: false, sprite: "ship_cargotran", buyable: true },
  merchant_freighter: { id: "merchant_freighter", name: "Coaster", turnsPerWarp: 2, offensiveOdds: 0.8, defensiveOdds: 0.8, maxFighters: 300, maxShields: 500, maxHolds: 65, transwarp: false, sprite: "ship_merchant_freighter", buyable: true },
  imperial_starship: { id: "imperial_starship", name: "Warden", turnsPerWarp: 4, offensiveOdds: 1.5, defensiveOdds: 1.5, maxFighters: 50000, maxShields: 2000, maxHolds: 150, transwarp: true, sprite: "ship_imperial_starship", buyable: true, requires: "commission" },
  havoc_gunstar: { id: "havoc_gunstar", name: "Hellion", turnsPerWarp: 3, offensiveOdds: 1.2, defensiveOdds: 1.2, maxFighters: 10000, maxShields: 3000, maxHolds: 50, transwarp: true, sprite: "ship_havoc_gunstar", buyable: true },
  starmaster: { id: "starmaster", name: "Meridian", turnsPerWarp: 3, offensiveOdds: 1.4, defensiveOdds: 1.4, maxFighters: 5000, maxShields: 2000, maxHolds: 73, transwarp: false, sprite: "ship_starmaster", buyable: true },
  constellation: { id: "constellation", name: "Harrier", turnsPerWarp: 3, offensiveOdds: 1.4, defensiveOdds: 1.4, maxFighters: 5000, maxShields: 750, maxHolds: 80, transwarp: false, sprite: "ship_constellation", buyable: true },
  tkhasi_orion: { id: "tkhasi_orion", name: "Stiletto", turnsPerWarp: 2, offensiveOdds: 1.1, defensiveOdds: 1.1, maxFighters: 750, maxShields: 750, maxHolds: 60, transwarp: false, sprite: "ship_tkhasi_orion", buyable: true },
  tholian_sentinel: { id: "tholian_sentinel", name: "Bastion", turnsPerWarp: 4, offensiveOdds: 1.0, defensiveOdds: 4.0, maxFighters: 2500, maxShields: 4000, maxHolds: 50, transwarp: false, sprite: "ship_tholian_sentinel", buyable: true },
  taurean_mule: { id: "taurean_mule", name: "Burro", turnsPerWarp: 4, offensiveOdds: 0.5, defensiveOdds: 0.5, maxFighters: 300, maxShields: 600, maxHolds: 150, transwarp: false, sprite: "ship_taurean_mule", buyable: true },
  interdictor_cruiser: { id: "interdictor_cruiser", name: "Gravewell", turnsPerWarp: 15, offensiveOdds: 1.2, defensiveOdds: 1.2, maxFighters: 100000, maxShields: 4000, maxHolds: 40, transwarp: false, sprite: "ship_interdictor_cruiser", buyable: true },
  // NPC hulls. The Maw's three come from the spec's pirate hull table; the Authority cruiser is ours (unverified).
  maw_raider: { id: "maw_raider", name: "Maw Raider", turnsPerWarp: 2, offensiveOdds: 1.0, defensiveOdds: 1.0, maxFighters: 3000, maxShields: 200, maxHolds: 50, transwarp: false, sprite: "npc_pirate_raider", buyable: false, npc: true },
  maw_cruiser: { id: "maw_cruiser", name: "Maw Battle Cruiser", turnsPerWarp: 3, offensiveOdds: 1.2, defensiveOdds: 1.2, maxFighters: 8000, maxShields: 800, maxHolds: 75, transwarp: false, sprite: "npc_pirate_cruiser", buyable: false, npc: true },
  maw_dreadnought: { id: "maw_dreadnought", name: "Maw Dreadnought", turnsPerWarp: 4, offensiveOdds: 1.4, defensiveOdds: 1.4, maxFighters: 15000, maxShields: 1000, maxHolds: 100, transwarp: false, sprite: "npc_pirate_dreadnought", buyable: false, npc: true },
  authority_cruiser: { id: "authority_cruiser", name: "Authority Patrol Cruiser", turnsPerWarp: 2, offensiveOdds: 1.5, defensiveOdds: 1.5, maxFighters: 50000, maxShields: 5000, maxHolds: 50, transwarp: false, sprite: "npc_authority_cruiser", buyable: false, npc: true },
  // Vey hulls (stats are ours, for playtesting).
  vey_courier: { id: "vey_courier", name: "Vey Courier", turnsPerWarp: 2, offensiveOdds: 0.8, defensiveOdds: 1.0, maxFighters: 800, maxShields: 600, maxHolds: 60, transwarp: false, sprite: "npc_vey_courier", buyable: false, npc: true },
  vey_hauler: { id: "vey_hauler", name: "Vey Hauler", turnsPerWarp: 3, offensiveOdds: 0.8, defensiveOdds: 1.0, maxFighters: 1500, maxShields: 1000, maxHolds: 120, transwarp: false, sprite: "npc_vey_hauler", buyable: false, npc: true },
  vey_warship: { id: "vey_warship", name: "Vey Warship", turnsPerWarp: 2, offensiveOdds: 1.3, defensiveOdds: 1.3, maxFighters: 4000, maxShields: 1200, maxHolds: 40, transwarp: false, sprite: "npc_vey_warship", buyable: false, npc: true },
  escape_pod: { id: "escape_pod", name: "Escape Pod", turnsPerWarp: 2, offensiveOdds: 0, defensiveOdds: 1, maxFighters: 0, maxShields: 0, maxHolds: 0, transwarp: false, sprite: "ship_escape_pod", buyable: false },
};

/** Price of the next `qty` holds when you already have `have`. */
export function holdsCost(s: { holdPriceBase: number; holdPriceStep: number }, have: number, qty: number): number {
  let total = 0;
  for (let i = 0; i < qty; i++) total += s.holdPriceBase + s.holdPriceStep * (have + i);
  return total;
}
