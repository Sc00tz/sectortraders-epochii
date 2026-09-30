import { and, desc, eq, isNull, lt, ne, sql } from "drizzle-orm";
import type { GameSettings } from "@st/shared";
import { schema, type Tx } from "./db";
import type { PlayerRow } from "./game";
import type { Mail } from "./messages";

/**
 * Take one pilot out of a galaxy for good, whether they walked away or were pruned for silence.
 *
 * Their fighters, mines, beacons, limpets, bookmarks, notices and log go with them (database
 * cascades). Their planets pass to a corpmate, or become unowned through `planets.owner_id`'s
 * `set null`. Bounties posted *on* them are refunded to the posters first, because deleting the row
 * would otherwise cascade those rows away and quietly pocket the stakes. A departing CEO hands the
 * chair to the most recently active remaining member.
 *
 * `alsoGoing` are other pilots being removed in the same sweep, so one leaver is never made heir to
 * another. `why` is a past-tense clause about the pilot, used as "<alias> <why>."
 *
 * The user account is untouched: they keep their other galaxies and can join this one again as a
 * new pilot.
 *
 * Note `corporations.ceo_id` has no foreign key (it would make a players <-> corporations cycle),
 * so the handover below is the only thing stopping a corporation pointing at a deleted row. Deleting
 * a player any other way will leave one behind.
 */
export async function removePlayer(
  tx: Tx, gameId: number, p: PlayerRow, mail: Mail, why: string, alsoGoing: Set<number> = new Set(),
) {
  let heir: number | null = null;
  if (p.corpId) {
    const [c] = await tx.select().from(schema.corporations).where(eq(schema.corporations.id, p.corpId));
    const rest = (await tx.select().from(schema.players)
      .where(and(eq(schema.players.corpId, p.corpId), ne(schema.players.id, p.id)))
      .orderBy(desc(schema.players.lastSeen))).filter((m) => !alsoGoing.has(m.id));
    if (c && rest.length) {
      if (c.ceoId === p.id) {
        await tx.update(schema.corporations).set({ ceoId: rest[0]!.id }).where(eq(schema.corporations.id, c.id));
        for (const m of rest) mail.to(m.id, "corp", `${p.alias} ${why}. ${m.id === rest[0]!.id ? "You are" : `${rest[0]!.alias} is`} now CEO of ${c.name}.`);
      } else {
        for (const m of rest) mail.to(m.id, "corp", `${p.alias} ${why} and is no longer in ${c.name}.`);
      }
      heir = c.ceoId === p.id ? rest[0]!.id : (alsoGoing.has(c.ceoId) ? rest[0]!.id : c.ceoId);
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
    if (alsoGoing.has(r.posterId) || r.posterId === p.id) continue;
    const amount = Number(r.total);
    await tx.update(schema.players).set({ credits: sql`${schema.players.credits} + ${amount}` }).where(eq(schema.players.id, r.posterId));
    mail.to(r.posterId, "info", `${p.alias} ${why}. Your bounty of ${amount.toLocaleString()} credits was refunded.`);
  }

  // Planets with no corp heir become unowned through the foreign key.
  await tx.delete(schema.players).where(eq(schema.players.id, p.id));
}

/**
 * At the daily reset, traders nobody has seen in `inactiveDays` are removed from the galaxy, as the
 * original did, so abandoned pilots don't hold sectors and planets forever. The per-pilot teardown
 * is `removePlayer` above; this only decides who goes and tells everyone who's left.
 */
export async function pruneInactive(tx: Tx, s: GameSettings, gameId: number, mail: Mail) {
  if (!s.inactiveDays) return [];
  const cutoff = new Date(Date.now() - s.inactiveDays * 86_400_000);
  const gone = await tx.select().from(schema.players)
    .where(and(eq(schema.players.gameId, gameId), isNull(schema.players.npc), lt(schema.players.lastSeen, cutoff)));
  if (!gone.length) return [];
  const goneIds = new Set(gone.map((p) => p.id));

  const why = `was removed after ${s.inactiveDays} days of silence`;
  for (const p of gone) await removePlayer(tx, gameId, p, mail, why, goneIds);

  const everyone = await tx.select({ id: schema.players.id }).from(schema.players).where(and(eq(schema.players.gameId, gameId), isNull(schema.players.npc)));
  const names = gone.map((p) => p.alias).join(", ");
  for (const p of everyone) mail.to(p.id, "info", `Lost to the void after ${s.inactiveDays} days of silence: ${names}. Their fighters and mines are gone${gone.some((g) => !g.corpId) ? ", and their planets are up for grabs" : ""}.`);
  return gone.map((p) => p.alias);
}
