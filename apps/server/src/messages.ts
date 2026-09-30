import { and, desc, eq, gt, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import type { MessageDto } from "@st/shared";
import { db, schema, type Tx } from "./db";

type Conn = Tx | typeof db;

/**
 * Collects log lines during a transaction; `flush` writes them and returns who to ping.
 * Writing inside the caller's transaction means a rolled-back action leaves no log.
 */
export class Mail {
  private rows: { playerId: number; kind: string; text: string }[] = [];
  to(playerId: number, kind: string, text: string) { this.rows.push({ playerId, kind, text }); return this; }
  async flush(tx: Conn): Promise<number[]> {
    if (!this.rows.length) return [];
    // NPCs don't read their mail, and traders removed in this transaction can't.
    const all = [...new Set(this.rows.map((r) => r.playerId))];
    const humans = new Set((await tx.select({ id: schema.players.id }).from(schema.players)
      .where(and(inArray(schema.players.id, all), isNull(schema.players.npc)))).map((r) => r.id));
    const rows = this.rows.filter((r) => humans.has(r.playerId));
    this.rows = [];
    if (rows.length) await tx.insert(schema.messages).values(rows);
    return all.filter((id) => humans.has(id));
  }
}

/** Log a line for everyone currently in a sector (optionally excluding one player). */
export async function mailSector(tx: Conn, mail: Mail, gameId: number, sector: number, exceptId: number, kind: string, text: string) {
  const here = await tx.select({ id: schema.players.id }).from(schema.players)
    .where(and(eq(schema.players.gameId, gameId), eq(schema.players.sector, sector), ne(schema.players.id, exceptId), isNull(schema.players.npc)));
  for (const p of here) mail.to(p.id, kind, text);
}

export async function unreadCount(playerId: number, lastRead: number): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.messages)
    .where(and(eq(schema.messages.playerId, playerId), gt(schema.messages.id, lastRead)));
  return r?.n ?? 0;
}

export async function listMessages(playerId: number, lastRead: number, limit = 100): Promise<MessageDto[]> {
  const rows = await db.select().from(schema.messages).where(eq(schema.messages.playerId, playerId))
    .orderBy(desc(schema.messages.id)).limit(limit);
  return rows.map((m) => ({ id: m.id, at: m.createdAt.toISOString(), kind: m.kind, text: m.text, read: m.id <= lastRead }));
}

export async function markRead(playerId: number) {
  const [r] = await db.select({ max: sql<number>`coalesce(max(${schema.messages.id}), 0)::int` }).from(schema.messages)
    .where(eq(schema.messages.playerId, playerId));
  await db.update(schema.players).set({ lastReadMessageId: r?.max ?? 0 }).where(eq(schema.players.id, playerId));
}

/** Daily housekeeping: drop log lines older than `days`. */
export async function pruneMessages(days: number) {
  await db.delete(schema.messages).where(sql`${schema.messages.createdAt} < now() - (${days} || ' days')::interval`);
}
