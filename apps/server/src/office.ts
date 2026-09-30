import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { COMMODITIES, COMMODITY_LABEL, type BountyDto, type Commodity } from "@st/shared";
import { db, schema, type Tx } from "./db";
import { GameError, getState, loadGame, lockPlayer, portHere, requirePlayer, setPlayer, withMail, type PlayerRow } from "./game";
import type { Mail } from "./messages";

/**
 * The Authority office at Keystone Station (commissions and bounties) and port upgrades.
 * Both bounties and upgrades are ways to buy alignment, as in the original.
 */

async function atKeystone(tx: Tx, gameId: number, p: PlayerRow) {
  if (!p.docked) throw new GameError("Dock at Keystone Station first");
  const port = await portHere(tx, gameId, p.sector);
  if (!port || port.cls !== 9) throw new GameError("The Authority office is at Keystone Station");
}

export async function requestCommission(gameId: number, userId: number) {
  const { settings: s } = await loadGame(gameId);
  const me = await requirePlayer(gameId, userId);
  await withMail(gameId, async (tx, mail) => {
    const p = await lockPlayer(tx, me.id);
    await atKeystone(tx, gameId, p);
    if (p.alignment >= s.commissionGrant) throw new GameError("You already hold a commission");
    if (p.alignment < s.commissionAlignment) throw new GameError(`The Authority commissions pilots with ${s.commissionAlignment} alignment or more; you have ${p.alignment}`);
    await setPlayer(tx, p.id, { alignment: s.commissionGrant });
    mail.to(p.id, "info", `The Sector Authority granted you a commission. Alignment raised to ${s.commissionGrant.toLocaleString()}; the Warden is yours to buy.`);
  });
  return getState(gameId, userId);
}

export async function mostWanted(gameId: number): Promise<BountyDto[]> {
  const rows = await db.select({
    targetId: schema.bounties.targetId, alias: schema.players.alias, alignment: schema.players.alignment,
    total: sql<number>`sum(${schema.bounties.amount})::bigint`, posters: sql<number>`count(distinct ${schema.bounties.posterId})::int`,
  }).from(schema.bounties).innerJoin(schema.players, eq(schema.players.id, schema.bounties.targetId))
    .where(eq(schema.bounties.gameId, gameId))
    .groupBy(schema.bounties.targetId, schema.players.alias, schema.players.alignment)
    .orderBy(desc(sql`sum(${schema.bounties.amount})`));
  return rows.map((r) => ({ ...r, total: Number(r.total) }));
}

/** Post a bounty on an evil player. The money is held by the Authority until someone collects. */
export async function postBounty(gameId: number, userId: number, alias: string, amount: number) {
  const { settings: s } = await loadGame(gameId);
  const a = Math.floor(amount);
  if (!(a >= s.bountyMin)) throw new GameError(`The smallest bounty is ${s.bountyMin.toLocaleString()} credits`);
  const me = await requirePlayer(gameId, userId);
  await withMail(gameId, async (tx, mail) => {
    const p = await lockPlayer(tx, me.id);
    await atKeystone(tx, gameId, p);
    const [t] = await tx.select().from(schema.players)
      .where(and(eq(schema.players.gameId, gameId), sql`lower(${schema.players.alias}) = lower(${alias.trim()})`, isNull(schema.players.npc)));
    if (!t) throw new GameError("No trader by that name in this game");
    if (t.id === p.id) throw new GameError("You can't put a price on your own head");
    if (t.alignment >= 0) throw new GameError(`The Authority only posts bounties on evil pilots; ${t.alias} isn't one`);
    if (p.credits < a) throw new GameError(`You have ${p.credits.toLocaleString()} credits`);
    const align = Math.floor(a / s.bountyCreditsPerAlignment);
    await setPlayer(tx, p.id, { credits: p.credits - a, alignment: p.alignment + align });
    await tx.insert(schema.bounties).values({ gameId, targetId: t.id, posterId: p.id, amount: a });
    mail.to(p.id, "info", `Posted a ${a.toLocaleString()} credit bounty on ${t.alias}. Alignment +${align}.`);
    mail.to(t.id, "combat", `Someone posted a ${a.toLocaleString()} credit bounty on your head.`);
  });
  return getState(gameId, userId);
}

/** A player with bounties on them was destroyed by another player: the killer collects. */
export async function payBounties(tx: Tx, victim: PlayerRow, killer: PlayerRow | null, mail: Mail) {
  if (!killer || killer.npc || killer.id === victim.id) return;
  const rows = await tx.select().from(schema.bounties).where(eq(schema.bounties.targetId, victim.id)).for("update");
  if (!rows.length) return;
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  await tx.delete(schema.bounties).where(eq(schema.bounties.targetId, victim.id));
  await tx.update(schema.players).set({ credits: sql`${schema.players.credits} + ${total}` }).where(eq(schema.players.id, killer.id));
  mail.to(killer.id, "combat", `The Sector Authority paid you ${total.toLocaleString()} credits in bounties on ${victim.alias}.`);
  for (const posterId of new Set(rows.map((r) => r.posterId))) {
    if (posterId !== killer.id) mail.to(posterId, "combat", `${killer.alias} collected your bounty on ${victim.alias}.`);
  }
}

/** Pay to grow a port's capacity for one commodity. Better ports help everyone, and earn alignment. */
export async function upgradePort(gameId: number, userId: number, commodity: Commodity, units: number) {
  const { settings: s } = await loadGame(gameId);
  if (!COMMODITIES.includes(commodity)) throw new GameError("Unknown commodity");
  const n = Math.floor(units);
  if (!(n > 0)) throw new GameError("Add at least one unit of capacity");
  const me = await requirePlayer(gameId, userId);
  await withMail(gameId, async (tx, mail) => {
    const p = await lockPlayer(tx, me.id);
    if (!p.docked) throw new GameError("Dock at the port first");
    const port = await portHere(tx, gameId, p.sector, true);
    const slot = port?.slots[commodity];
    if (!port || port.cls === 0 || port.cls === 9 || !slot) throw new GameError("This port doesn't trade that");
    const room = s.portMaxCapacity - slot.max;
    if (room <= 0) throw new GameError(`${port.name}'s ${COMMODITY_LABEL[commodity]} is already as big as ports get`);
    if (n > room) throw new GameError(`It can grow by at most ${room.toLocaleString()} more`);
    const cost = n * s.portUpgradeCostPerUnit;
    if (p.credits < cost) throw new GameError(`That costs ${cost.toLocaleString()} credits; you have ${p.credits.toLocaleString()}`);
    const align = Math.floor(cost / s.portUpgradeCreditsPerAlignment);
    await setPlayer(tx, p.id, { credits: p.credits - cost, alignment: p.alignment + align });
    await tx.update(schema.ports).set({ slots: { ...port.slots, [commodity]: { ...slot, max: slot.max + n } } })
      .where(and(eq(schema.ports.gameId, gameId), eq(schema.ports.sectorId, port.sectorId)));
    mail.to(p.id, "shop", `Upgraded ${port.name}'s ${COMMODITY_LABEL[commodity]} capacity by ${n.toLocaleString()} for ${cost.toLocaleString()} credits.${align ? ` Alignment +${align}.` : ""}`);
  });
  return getState(gameId, userId);
}
