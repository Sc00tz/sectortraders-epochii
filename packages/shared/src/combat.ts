/**
 * Fighter combat, per the spec: each side's fighters destroy the other's at their odds
 * (kills = fighters x attacker odds / defender odds), then leftover attackers hit shields,
 * which absorb `shieldOdds` fighters per point. Anything left after the shields is a kill.
 * Deterministic on purpose, so players can do the arithmetic in their heads.
 */
export interface CombatInput {
  attFighters: number;
  attOdds: number;
  defFighters: number;
  defOdds: number;
  defShields: number;
  shieldOdds: number;
}

export interface CombatResult {
  attLost: number;
  defFightersLost: number;
  defShieldsLost: number;
  destroyed: boolean; // defender's fighters and shields were all overwhelmed
}

export function resolveCombat(c: CombatInput): CombatResult {
  const A = Math.max(0, Math.floor(c.attFighters));
  const D = Math.max(0, Math.floor(c.defFighters));
  const S = Math.max(0, Math.floor(c.defShields));
  if (A === 0 || c.attOdds <= 0) return { attLost: 0, defFightersLost: 0, defShieldsLost: 0, destroyed: false };
  const powerA = A * c.attOdds;
  const powerD = D * c.defOdds;
  if (powerA <= powerD) {
    // Attack wave is wiped out; it takes some defenders with it.
    return { attLost: A, defFightersLost: Math.min(D, Math.floor(powerA / c.defOdds)), defShieldsLost: 0, destroyed: false };
  }
  // Defenders all fall; attackers spent on them are gone.
  const spentOnFighters = Math.min(A, Math.ceil(powerD / c.attOdds));
  let remaining = A - spentOnFighters;
  const shieldsLost = Math.min(S, Math.ceil(remaining / c.shieldOdds));
  const spentOnShields = Math.min(remaining, shieldsLost * c.shieldOdds);
  remaining -= spentOnShields;
  const destroyed = shieldsLost === S && remaining > 0;
  return { attLost: spentOnFighters + spentOnShields, defFightersLost: D, defShieldsLost: shieldsLost, destroyed };
}

/** Damage from mines: shields soak first, then fighters. Returns what was lost and whether the ship died. */
export function applyDamage(damage: number, fighters: number, shields: number) {
  const shieldsLost = Math.min(shields, damage);
  const rest = damage - shieldsLost;
  const fightersLost = Math.min(fighters, rest);
  return { shieldsLost, fightersLost, destroyed: rest - fightersLost > 0 };
}

/** FedSpace protection per the spec: alignment >= 0, under the XP cap, and under the fighter cap. */
export function fedProtected(s: { fedMaxXp: number; fedMaxFighters: number }, p: { alignment: number; experience: number; fighters: number }) {
  return p.alignment >= 0 && p.experience < s.fedMaxXp && p.fighters < s.fedMaxFighters;
}

/** How many armid mines go off when a ship enters: each has `chance` to detonate. */
export function armidsTriggered(count: number, chance: number, rand: () => number = Math.random) {
  let n = 0;
  for (let i = 0; i < count; i++) if (rand() < chance) n++;
  return n;
}
