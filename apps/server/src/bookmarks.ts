import { and, asc, eq, sql } from "drizzle-orm";
import type { BookmarkDto } from "@st/shared";
import { db, schema } from "./db";
import { GameError, loadGame, requirePlayer } from "./game";

/**
 * Named sectors, private to each trader: "main planet", "cheap ore", "the tavern". Purely a
 * convenience for finding places again, so there's nothing to lock and no turn cost. They travel
 * with the pilot, not the account: leaving a galaxy takes them with it (a database cascade).
 */

const MAX_LABEL = 40;

export async function listBookmarks(gameId: number, userId: number): Promise<BookmarkDto[]> {
  const p = await requirePlayer(gameId, userId);
  return db.select({ sector: schema.bookmarks.sectorId, label: schema.bookmarks.label })
    .from(schema.bookmarks).where(eq(schema.bookmarks.playerId, p.id))
    .orderBy(asc(schema.bookmarks.sectorId));
}

/** Name a sector, or rename one you've already named. Renaming never counts against the cap. */
export async function setBookmark(gameId: number, userId: number, sector: number, label: string) {
  const { settings: s } = await loadGame(gameId);
  const p = await requirePlayer(gameId, userId);
  sector = Math.floor(sector);
  if (!Number.isSafeInteger(sector) || sector < 1 || sector > s.sectors) throw new GameError("No such sector");
  // Collapse runs of whitespace so a label can't be padded out to look like several.
  const clean = label.replace(/\s+/gu, " ").trim();
  if (!clean) throw new GameError("Give the bookmark a name");
  if (clean.length > MAX_LABEL) throw new GameError(`A bookmark name can be at most ${MAX_LABEL} characters`);
  if (/\p{C}/u.test(clean)) throw new GameError("That name has characters we can't store");
  await db.transaction(async (tx) => {
    const [existing] = await tx.select({ sectorId: schema.bookmarks.sectorId }).from(schema.bookmarks)
      .where(and(eq(schema.bookmarks.playerId, p.id), eq(schema.bookmarks.sectorId, sector))).limit(1);
    if (!existing) {
      const [row] = await tx.select({ count: sql<number>`count(*)::int` }).from(schema.bookmarks)
        .where(eq(schema.bookmarks.playerId, p.id));
      const count = row?.count ?? 0;
      if (count >= s.maxBookmarks) {
        throw new GameError(s.maxBookmarks === 0
          ? "Bookmarks are switched off in this galaxy"
          : `You can keep ${s.maxBookmarks} bookmarks. Remove one first.`);
      }
    }
    await tx.insert(schema.bookmarks).values({ playerId: p.id, sectorId: sector, label: clean })
      .onConflictDoUpdate({
        target: [schema.bookmarks.playerId, schema.bookmarks.sectorId],
        set: { label: clean },
      });
  });
  return listBookmarks(gameId, userId);
}

export async function removeBookmark(gameId: number, userId: number, sector: number) {
  const p = await requirePlayer(gameId, userId);
  sector = Math.floor(sector);
  if (!Number.isSafeInteger(sector)) throw new GameError("No such sector");
  await db.delete(schema.bookmarks)
    .where(and(eq(schema.bookmarks.playerId, p.id), eq(schema.bookmarks.sectorId, sector)));
  return listBookmarks(gameId, userId);
}
