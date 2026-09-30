/**
 * Ranks, per the spec: 22 thresholds doubling from 2 XP to 4,194,304 XP, with separate title sets for
 * good and evil pilots (alignment below zero). The titles are ours.
 */
export const GOOD_TITLES = [
  "Drifter", "Deckhand", "Spacer", "Hauler", "Pilot", "Navigator", "Trader", "Merchant", "Courier Captain",
  "Captain", "Senior Captain", "Commodore", "Convoy Master", "Wayfinder", "Guildmaster", "Marshal",
  "High Marshal", "Warden of the Lanes", "Star Envoy", "Paragon", "Luminary", "Legend of the Lanes", "Hero of the Epoch",
] as const;

export const EVIL_TITLES = [
  "Drifter", "Stowaway", "Scavenger", "Smuggler", "Cutpurse", "Bandit", "Brigand", "Freebooter", "Raider",
  "Corsair", "Marauder", "Plunderer", "Blackguard", "Gang Boss", "Pirate Lord", "Scourge",
  "Dread Captain", "Void Tyrant", "Terror of the Lanes", "Nightmare", "Harbinger", "Living Infamy", "Villain of the Epoch",
] as const;

/** 0 below 2 XP, then one step per doubling, up to 22 at 4,194,304 XP. */
export function rankTier(xp: number) {
  let tier = 0;
  while (tier < 22 && xp >= 2 ** (tier + 1)) tier++;
  return tier;
}

export function rankTitle(xp: number, alignment: number) {
  return (alignment < 0 ? EVIL_TITLES : GOOD_TITLES)[rankTier(xp)]!;
}

/** XP needed for the next rank, or null at the top. */
export function nextRankXp(xp: number) {
  const t = rankTier(xp);
  return t >= 22 ? null : 2 ** (t + 1);
}
