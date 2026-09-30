import { and, desc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { COMMODITIES, COMMODITY_LABEL, unitPriceAt, type TavernPostDto } from "@st/shared";
import { db, schema, type Tx } from "./db";
import { GameError, adjacency, getState, loadGame, lockPlayer, portHere, requirePlayer, setPlayer, withMail, type PlayerRow } from "./game";

/**
 * Talking: direct messages, the sector radio, the galaxy-wide Authority channel, and the
 * Keystone Station tavern (a paid notice board and a keeper who sells rumors).
 * Everything spoken lands in the recipients' logs, so it reaches offline players too.
 */

const MAX_LEN = 400;
const lastSent = new Map<number, number>(); // playerId -> ms; a light flood guard, reset on restart

function clean(text: string) {
  const t = text.trim().replace(/\s+/g, " ").slice(0, MAX_LEN);
  if (!t) throw new GameError("Say something");
  return t;
}

function throttle(p: PlayerRow) {
  const now = Date.now();
  if (now - (lastSent.get(p.id) ?? 0) < 1500) throw new GameError("Easy on the transmitter: wait a moment between messages");
  lastSent.set(p.id, now);
}

export async function sendDirect(gameId: number, userId: number, alias: string, text: string) {
  const line = clean(text);
  const me = await requirePlayer(gameId, userId);
  throttle(me);
  await withMail(gameId, async (tx, mail) => {
    const [t] = await tx.select().from(schema.players)
      .where(and(eq(schema.players.gameId, gameId), sql`lower(${schema.players.alias}) = lower(${alias.trim()})`, isNull(schema.players.npc)));
    if (!t) throw new GameError("No trader by that name in this game");
    if (t.id === me.id) throw new GameError("Talking to yourself?");
    mail.to(t.id, "dm", `${me.alias} → you: ${line}`);
    mail.to(me.id, "dm", `You → ${t.alias}: ${line}`);
  });
  return { ok: true };
}

/** Subspace radio: everyone in your sector hears it. */
export async function radio(gameId: number, userId: number, text: string) {
  const line = clean(text);
  const me = await requirePlayer(gameId, userId);
  throttle(me);
  await withMail(gameId, async (tx, mail) => {
    const here = await tx.select({ id: schema.players.id }).from(schema.players)
      .where(and(eq(schema.players.gameId, gameId), eq(schema.players.sector, me.sector), isNull(schema.players.npc)));
    for (const p of here) mail.to(p.id, "radio", `[Sector ${me.sector} radio] ${me.alias}: ${line}`);
  });
  return { ok: true };
}

/** The Authority channel: every trader in the galaxy hears it. */
export async function broadcast(gameId: number, userId: number, text: string) {
  const line = clean(text);
  const me = await requirePlayer(gameId, userId);
  throttle(me);
  await withMail(gameId, async (tx, mail) => {
    const all = await tx.select({ id: schema.players.id }).from(schema.players)
      .where(and(eq(schema.players.gameId, gameId), isNull(schema.players.npc)));
    for (const p of all) mail.to(p.id, "comm", `[Authority channel] ${me.alias}: ${line}`);
  });
  return { ok: true };
}

// ---------- the tavern ----------

async function atTavern(tx: Tx | typeof db, gameId: number, p: PlayerRow) {
  if (!p.docked) throw new GameError("Dock at Keystone Station first");
  const port = await portHere(tx, gameId, p.sector);
  if (!port || port.cls !== 9) throw new GameError("The tavern is at Keystone Station");
}

export async function tavernBoard(gameId: number, userId: number): Promise<TavernPostDto[]> {
  const p = await requirePlayer(gameId, userId);
  await atTavern(db, gameId, p);
  const rows = await db.select({ id: schema.tavernPosts.id, alias: schema.players.alias, text: schema.tavernPosts.text, at: schema.tavernPosts.createdAt })
    .from(schema.tavernPosts).innerJoin(schema.players, eq(schema.players.id, schema.tavernPosts.playerId))
    .where(eq(schema.tavernPosts.gameId, gameId)).orderBy(desc(schema.tavernPosts.id)).limit(30);
  return rows.map((r) => ({ ...r, at: r.at.toISOString() }));
}

export async function postNotice(gameId: number, userId: number, text: string) {
  const { settings: s } = await loadGame(gameId);
  const line = clean(text).slice(0, 200);
  const me = await requirePlayer(gameId, userId);
  await withMail(gameId, async (tx) => {
    const p = await lockPlayer(tx, me.id);
    await atTavern(tx, gameId, p);
    if (p.credits < s.tavernPostPrice) throw new GameError(`A notice costs ${s.tavernPostPrice.toLocaleString()} credits`);
    await setPlayer(tx, p.id, { credits: p.credits - s.tavernPostPrice });
    await tx.insert(schema.tavernPosts).values({ gameId, playerId: p.id, text: line });
    // Keep the board to the most recent 200 notices.
    await tx.execute(sql`delete from tavern_posts where game_id = ${gameId} and id not in (select id from tavern_posts where game_id = ${gameId} order by id desc limit 200)`);
  });
  return getState(gameId, userId);
}

/** Sectors within `depth` jumps of `from` (either direction of travel counts as "near"). */
async function near(gameId: number, from: number, depth: number) {
  const adj = await adjacency(gameId);
  const seen = new Map<number, number>([[from, 0]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    if (seen.get(cur)! >= depth) continue;
    for (const n of adj.get(cur) ?? []) if (!seen.has(n)) { seen.set(n, seen.get(cur)! + 1); queue.push(n); }
  }
  return seen;
}

/** Something true the keeper has overheard. */
async function rumor(gameId: number, me: PlayerRow): Promise<string> {
  const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
  const options: (() => Promise<string | null>)[] = [
    async () => {
      const [maw] = await db.select().from(schema.factions).where(and(eq(schema.factions.gameId, gameId), eq(schema.factions.faction, "maw")));
      if (!maw?.homeSector) return null;
      const ring = [...(await near(gameId, maw.homeSector, 3)).entries()].filter(([, d]) => d === 3).map(([id]) => id);
      const hint = pick(ring);
      return hint ? `"Maw raiders come and go around sector ${hint}. Their nest can't be more than a few jumps from there."` : null;
    },
    async () => {
      const raiders = await db.select().from(schema.players).where(and(eq(schema.players.gameId, gameId), eq(schema.players.npcRole, "raider")));
      const r = pick(raiders);
      return r ? `"${r.alias} was spotted in sector ${r.sector} not long ago. I'd steer clear."` : null;
    },
    async () => {
      const ports = await db.select().from(schema.ports).where(eq(schema.ports.gameId, gameId));
      const s = (await loadGame(gameId)).settings;
      const deals = ports.flatMap((port) => COMMODITIES.flatMap((c) => {
        const slot = port.slots[c];
        return slot && slot.dir === "sell" && slot.stock > slot.max * 0.6 ? [{ port, c, price: unitPriceAt(s.commodityBasePrice[c], slot, slot.stock / slot.max) }] : [];
      }));
      const d = pick(deals);
      return d ? `"${COMMODITY_LABEL[d.c]}'s going cheap at ${d.port.name}, sector ${d.port.sectorId}. Well stocked, last I heard."` : null;
    },
    async () => {
      const [pl] = await db.select().from(schema.planets).where(and(eq(schema.planets.gameId, gameId), isNotNull(schema.planets.ownerId), sql`${schema.planets.citadel} > 0`))
        .orderBy(desc(schema.planets.citadel), desc(schema.planets.fighters)).limit(1);
      return pl ? `"The toughest rock anyone talks about is ${pl.name}, out in sector ${pl.sectorId}. Citadel level ${pl.citadel}."` : null;
    },
    async () => {
      const [b] = await db.select({ alias: schema.players.alias, total: sql<number>`sum(${schema.bounties.amount})::bigint` })
        .from(schema.bounties).innerJoin(schema.players, eq(schema.players.id, schema.bounties.targetId))
        .where(eq(schema.bounties.gameId, gameId)).groupBy(schema.players.alias).orderBy(desc(sql`sum(${schema.bounties.amount})`)).limit(1);
      return b ? `"Whoever brings down ${b.alias} walks away with ${Number(b.total).toLocaleString()} credits in bounties."` : null;
    },
    async () => {
      const vey = await db.select().from(schema.players).where(and(eq(schema.players.gameId, gameId), eq(schema.players.npc, "vey"), ne(schema.players.id, me.id)));
      const v = pick(vey);
      return v ? `"A Vey ship, ${v.alias}, came through sector ${v.sector}. ${v.alignment < 0 ? "Watch that one. It's gone raider." : "Peaceful sort. Buys what the ports sell."}"` : null;
    },
  ];
  for (const f of options.sort(() => Math.random() - 0.5)) {
    const r = await f();
    if (r) return r;
  }
  return `"Quiet out there lately. Too quiet, if you ask me."`;
}

export async function buyRumor(gameId: number, userId: number) {
  const { settings: s } = await loadGame(gameId);
  const me = await requirePlayer(gameId, userId);
  await withMail(gameId, async (tx) => {
    const p = await lockPlayer(tx, me.id);
    await atTavern(tx, gameId, p);
    if (p.credits < s.tavernRumorPrice) throw new GameError(`The keeper wants ${s.tavernRumorPrice.toLocaleString()} credits for that`);
    await setPlayer(tx, p.id, { credits: p.credits - s.tavernRumorPrice });
  });
  const line = await rumor(gameId, me);
  await withMail(gameId, async (_tx, mail) => { mail.to(me.id, "tavern", `The tavern keeper leans in: ${line}`); });
  return { line, state: await getState(gameId, userId) };
}

/** For a price, the keeper says where a trader was last seen. Cloaked ships leave no trail. */
export async function traceTrader(gameId: number, userId: number, alias: string) {
  const { settings: s } = await loadGame(gameId);
  const me = await requirePlayer(gameId, userId);
  let line = "";
  await withMail(gameId, async (tx, mail) => {
    const p = await lockPlayer(tx, me.id);
    await atTavern(tx, gameId, p);
    const [t] = await tx.select().from(schema.players)
      .where(and(eq(schema.players.gameId, gameId), sql`lower(${schema.players.alias}) = lower(${alias.trim()})`));
    if (!t) throw new GameError("\"Never heard of 'em.\" (No trader by that name.)");
    if (t.cloaked) { line = `"${t.alias}? Nobody's seen hide nor hair of that one lately." (No charge.)`; return; }
    if (p.credits < s.tavernTracePrice) throw new GameError(`The keeper wants ${s.tavernTracePrice.toLocaleString()} credits for that`);
    await setPlayer(tx, p.id, { credits: p.credits - s.tavernTracePrice });
    line = `"${t.alias}? Last I heard, sector ${t.sector}${t.landedPlanetId ? ", sitting on a planet" : ""}."`;
    mail.to(p.id, "tavern", `The tavern keeper, on ${t.alias}: ${line}`);
  });
  return { line, state: await getState(gameId, userId) };
}
