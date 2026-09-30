import { and, desc, eq, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import type { GameSettings } from "@st/shared";
import { schema, type Tx } from "./db";
import type { Mail } from "./messages";

/**
 * At the daily reset, traders nobody has seen in `inactiveDays` are removed from the galaxy, as the
 * original did, so abandoned pilots don't hold sectors and planets forever. Their fighters, mines,
 * beacons, limpets and notices go with them (database cascades). Their planets pass to a corpmate
 * (the CEO, or whoever takes over), or become unowned. Bounties on them are refunded to the posters.
 * The user account stays; they can join again as a new pilot.
 */
export async function pruneInactive(tx: Tx, s: GameSettings, gameId: number, mail: Mail) {
  if (!s.inactiveDays) return [];
  const cutoff = new Date(Date.now() - s.inactiveDays * 86_400_000);
  const gone = await tx.select().from(schema.players)
    .where(and(eq(schema.players.gameId, gameId), isNull(schema.players.npc), lt(schema.players.lastSeen, cutoff)));
  if (!gone.length) return [];
  const goneIds = new Set(gone.map((p) => p.id));

  for (const p of gone) {
    // The corporation: a departing CEO hands over to the most recently active remaining member.
    let heir: number | null = null;
    if (p.corpId) {
      const [c] = await tx.select().from(schema.corporations).where(eq(schema.corporations.id, p.corpId));
      const rest = (await tx.select().from(schema.players)
        .where(and(eq(schema.players.corpId, p.corpId), ne(schema.players.id, p.id)))
        .orderBy(desc(schema.players.lastSeen))).filter((m) => !goneIds.has(m.id));
      if (c && rest.length) {
        if (c.ceoId === p.id) {
          await tx.update(schema.corporations).set({ ceoId: rest[0]!.id }).where(eq(schema.corporations.id, c.id));
          for (const m of rest) mail.to(m.id, "corp", `${p.alias} hasn't been seen in ${s.inactiveDays} days and was removed. ${m.id === rest[0]!.id ? "You are" : `${rest[0]!.alias} is`} now CEO of ${c.name}.`);
        } else {
          for (const m of rest) mail.to(m.id, "corp", `${p.alias} hasn't been seen in ${s.inactiveDays} days and was removed from ${c.name}.`);
        }
        heir = c.ceoId === p.id ? rest[0]!.id : (goneIds.has(c.ceoId) ? rest[0]!.id : c.ceoId);
      } else if (c) {
        // Nobody left: the corporation (and its treasury) goes too.
        await tx.update(schema.players).set({ corpId: null }).where(eq(schema.players.corpId, c.id));
        await tx.delete(schema.corporations).where(eq(schema.corporations.id, c.id));
      }
    }
    if (heir) {
      const n = await tx.update(schema.planets).set({ ownerId: heir })
        .where(and(eq(schema.planets.gameId, gameId), eq(schema.planets.ownerId, p.id))).returning({ id: schema.planets.id });
      if (n.length) mail.to(heir, "planet", `${n.length} planet${n.length > 1 ? "s" : ""} that belonged to ${p.alias} ${n.length > 1 ? "are" : "is"} now yours.`);
    }

    // Refund bounties posted on them.
    const refunds = await tx.select({ posterId: schema.bounties.posterId, total: sql<number>`sum(${schema.bounties.amount})::bigint` })
      .from(schema.bounties).where(eq(schema.bounties.targetId, p.id)).groupBy(schema.bounties.posterId);
    for (const r of refunds) {
      if (goneIds.has(r.posterId)) continue;
      const amount = Number(r.total);
      await tx.update(schema.players).set({ credits: sql`${schema.players.credits} + ${amount}` }).where(eq(schema.players.id, r.posterId));
      mail.to(r.posterId, "info", `${p.alias} was removed for inactivity. Your bounty of ${amount.toLocaleString()} credits was refunded.`);
    }
  }

  // Planets left behind (no corp heir) become unowned through the foreign key.
  await tx.delete(schema.players).where(inArray(schema.players.id, [...goneIds]));
  const everyone = await tx.select({ id: schema.players.id }).from(schema.players).where(and(eq(schema.players.gameId, gameId), isNull(schema.players.npc)));
  const names = gone.map((p) => p.alias).join(", ");
  for (const p of everyone) mail.to(p.id, "info", `Lost to the void after ${s.inactiveDays} days of silence: ${names}. Their fighters and mines are gone${gone.some((g) => !g.corpId) ? ", and their planets are up for grabs" : ""}.`);
  return gone.map((p) => p.alias);
}
