/** In-game names for places that the original game named. Change them here; nothing else hard-codes them. */
export const PLACE = {
  core: "Core Space", // the protected starting sectors (the original's "FedSpace")
  coreShort: "Core",
  keystone: "Keystone Station", // the ship and hardware yard (the original's "Stardock")
  homeWorld: "Cradle", // sector 1's world, where colonists come from
  depots: ["Cradle Depot", "Deepstone Depot", "Ringwall Depot"], // the three Class 0 hardware depots
} as const;

/** Display names for mine types. "armid" stays the internal key (it's stored); players see "burst". */
export const MINE_NAME = { armid: "burst", limpet: "limpet" } as const;
