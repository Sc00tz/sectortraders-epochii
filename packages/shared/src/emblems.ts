/**
 * Corporation emblems: a CEO picks one. Each is a sprite `corp_emblem_<id>.png`; they share one badge
 * shape (a beveled steel ring around a colored disc) so they read as a family, distinct from the
 * faction emblems (Authority shield, Maw gear, Vey hexagon).
 */
export const CORP_EMBLEMS = [
  { id: "anchor", name: "Anchor" },
  { id: "wolf", name: "Wolf" },
  { id: "hawk", name: "Hawk" },
  { id: "wrenches", name: "Crossed wrenches" },
  { id: "crown", name: "Crown" },
  { id: "flame", name: "Flame" },
  { id: "trident", name: "Trident" },
  { id: "bolt", name: "Lightning bolt" },
  { id: "ringed_planet", name: "Ringed planet" },
  { id: "serpent", name: "Serpent" },
  { id: "fist", name: "Fist" },
  { id: "crystal", name: "Crystal" },
  { id: "skull", name: "Skull" },
  { id: "key", name: "Key" },
  { id: "atom", name: "Atom" },
  { id: "swords", name: "Crossed swords" },
] as const;

export type CorpEmblemId = (typeof CORP_EMBLEMS)[number]["id"];
export const isCorpEmblem = (id: string): id is CorpEmblemId => CORP_EMBLEMS.some((e) => e.id === id);
export const corpEmblemSprite = (id: string) => `corp_emblem_${id}`;
