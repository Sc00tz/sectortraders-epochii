import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { PLACE,
  COMMODITIES, SHIP_TYPES, applyDamage, crossCheckSettings, rankTitle, validateSettingsPatch, armidsTriggered, fedProtected, portPatternCode, quoteTotal, maxTradeQty,
  resolveCombat, resolveOffer, resolveSettings, startHaggle, unitPriceAt,
  type ActionResultDto, type Commodity, type GameSettings, type Haggle, type MapDto, type OfferResultDto,
  type PlayerDto, type PortDto, type QuoteDto, type SectorDto, type SectorEventDto, type StateDto,
} from "@st/shared";
import { db, schema, type Tx } from "./db";
import { generateUniverse, plotCourse } from "./universe";
import { Mail, mailSector, pruneMessages, unreadCount } from "./messages";
import { dailyPlanets, interdicted, planetDefenses, planetSummaries } from "./planets";
import { ensureNpcs, hostileTo, npcAmbush, npcDestroyed, npcInfo } from "./npc";
import { dailyGear } from "./gear";
import { pruneInactive } from "./cleanup";
import { payBounties } from "./office";

export class GameError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/** Realtime hooks, wired up by realtime.ts. */
export const events = {
  /** Something happened in a sector: everyone viewing it refreshes. */
  emit: (_gameId: number, _e: SectorEventDto) => {},
  /** These players have new log messages. */
  ping: (_gameId: number, _playerIds: number[]) => {},
};

export type PlayerRow = typeof schema.players.$inferSelect;
type PortRow = typeof schema.ports.$inferSelect;
type Conn = Tx | typeof db;

const cargoCol = { ore: "cargoOre", org: "cargoOrg", equ: "cargoEqu" } as const;

/** Holds in use: commodities plus colonists (colonists ride in cargo holds). */
export function usedHolds(p: Pick<PlayerRow, "cargoOre" | "cargoOrg" | "cargoEqu" | "cargoColonists">) {
  return p.cargoOre + p.cargoOrg + p.cargoEqu + p.cargoColonists;
}
export function freeHolds(p: PlayerRow) { return p.holds - usedHolds(p); }

/** Colonists waiting at the home world; games created before planets existed start with a full pool. */
export async function homeColonists(gameId: number, s: GameSettings) {
  const [g] = await db.select({ pool: schema.games.colonistPool }).from(schema.games).where(eq(schema.games.id, gameId));
  return g?.pool ?? s.colonistsStart;
}

// ---------- caches (warps and settings never change after the Big Bang) ----------

const adjCache = new Map<number, Map<number, number[]>>();
export async function adjacency(gameId: number): Promise<Map<number, number[]>> {
  let adj = adjCache.get(gameId);
  if (adj) return adj;
  const rows = await db.select().from(schema.warps).where(eq(schema.warps.gameId, gameId));
  adj = new Map();
  for (const w of rows) {
    if (!adj.has(w.fromSector)) adj.set(w.fromSector, []);
    adj.get(w.fromSector)!.push(w.toSector);
  }
  for (const list of adj.values()) list.sort((a, b) => a - b);
  adjCache.set(gameId, adj);
  return adj;
}

export async function loadGame(gameId: number) {
  const [g] = await db.select().from(schema.games).where(eq(schema.games.id, gameId)).limit(1);
  if (!g) throw new GameError("No such game", 404);
  return { ...g, settings: resolveSettings(g.settings) };
}

export async function isFedspace(conn: Conn, gameId: number, sector: number) {
  const [s] = await conn.select({ f: schema.sectors.fedspace }).from(schema.sectors)
    .where(and(eq(schema.sectors.gameId, gameId), eq(schema.sectors.id, sector))).limit(1);
  return !!s?.f;
}

/** Run a transaction that may write log lines, then ping the recipients once it has committed. */
export async function withMail<T>(gameId: number, fn: (tx: Tx, mail: Mail) => Promise<T>): Promise<T> {
  let pinged: number[] = [];
  const out = await db.transaction(async (tx) => {
    const mail = new Mail();
    const r = await fn(tx, mail);
    pinged = await mail.flush(tx);
    return r;
  });
  if (pinged.length) events.ping(gameId, pinged);
  return out;
}

// ---------- game creation and joining ----------

async function insertChunked<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += 1000) await insert(rows.slice(i, i + 1000));
}

export async function createGame(name: string, overrides: Partial<GameSettings> = {}) {
  const settings = resolveSettings(overrides);
  const problem = crossCheckSettings(settings);
  if (problem) throw new GameError(problem);
  if (!settings.seed) settings.seed = Math.floor(Math.random() * 2 ** 31) + 1;
  if (settings.sectors < 100 || settings.sectors > 30000) throw new GameError("Sectors must be 100-30,000");
  const u = generateUniverse(settings, settings.seed);
  return db.transaction(async (tx) => {
    const [game] = await tx.insert(schema.games).values({ name, settings, stardock: u.stardock, colonistPool: settings.colonistsStart }).returning();
    const gameId = game!.id;
    await insertChunked(u.sectors, (c) => tx.insert(schema.sectors).values(c.map((s) => ({ gameId, ...s }))));
    await insertChunked(u.warps, (c) => tx.insert(schema.warps).values(c.map(([a, b]) => ({ gameId, fromSector: a, toSector: b }))));
    await insertChunked(u.ports, (c) => tx.insert(schema.ports).values(c.map((p) => ({ gameId, ...p }))));
    await insertChunked(u.planets, (c) => tx.insert(schema.planets).values(c.map((p) => ({ gameId, ...p }))));
    return game!;
  });
}

export async function joinGame(gameId: number, userId: number, alias: string) {
  const game = await loadGame(gameId);
  const s = game.settings;
  alias = alias.trim();
  if (!/^[A-Za-z0-9 _'-]{3,24}$/.test(alias)) throw new GameError("Trader name must be 3-24 letters, numbers, spaces, _ ' or -");
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.players).where(and(eq(schema.players.gameId, gameId), isNull(schema.players.npc)));
  if (count >= s.maxPlayers) throw new GameError("This game is full");
  const taken = await db.select({ id: schema.players.id }).from(schema.players)
    .where(and(eq(schema.players.gameId, gameId), sql`lower(${schema.players.alias}) = lower(${alias})`)).limit(1);
  if (taken.length) throw new GameError("That trader name is taken in this game", 409);
  if (await playerFor(gameId, userId)) throw new GameError("You have already joined this game", 409);
  const p = await withMail(gameId, async (tx, mail) => {
    const [p] = await tx.insert(schema.players).values({
      gameId, userId, alias, sector: 1, credits: s.startingCredits, turns: s.turnsPerDay, ship: s.startingShip,
      holds: s.startingHolds, fighters: s.startingFighters,
    }).returning();
    await tx.insert(schema.visited).values({ playerId: p!.id, sectorId: 1 }).onConflictDoNothing();
    mail.to(p!.id, "info", `Welcome to ${game.name}, ${alias}. Your ${SHIP_TYPES[p!.ship]!.name} is fueled at ${PLACE.depots[0]} in sector 1.`);
    await mailSector(tx, mail, gameId, 1, p!.id, "traffic", `${alias} has entered the universe in sector 1.`);
    return p!;
  });
  events.emit(gameId, { kind: "arrive", sector: 1, alias, ship: p.ship, message: `${alias} has entered the universe.` });
  return p;
}

export async function playerFor(gameId: number, userId: number): Promise<PlayerRow | null> {
  const [p] = await db.select().from(schema.players)
    .where(and(eq(schema.players.gameId, gameId), eq(schema.players.userId, userId))).limit(1);
  return p ?? null;
}

export async function requirePlayer(gameId: number, userId: number): Promise<PlayerRow> {
  const p = await playerFor(gameId, userId);
  if (!p) throw new GameError("You haven't joined this game", 403);
  return p;
}

export async function lockPlayer(tx: Tx, playerId: number): Promise<PlayerRow> {
  const [p] = await tx.select().from(schema.players).where(eq(schema.players.id, playerId)).for("update");
  if (!p) throw new GameError("No such player", 404);
  return p;
}

export async function setPlayer(tx: Tx, id: number, patch: Partial<PlayerRow>) {
  await tx.update(schema.players).set(patch).where(eq(schema.players.id, id));
}

// ---------- read models ----------

function portDto(s: GameSettings, port: PortRow): PortDto {
  const slots = COMMODITIES.flatMap((c) => {
    const slot = port.slots[c];
    if (!slot) return [];
    const price = unitPriceAt(s.commodityBasePrice[c], slot, slot.stock / slot.max);
    return [{ commodity: c, dir: slot.dir, stock: slot.stock, max: slot.max, unitPrice: Math.round(price * 10) / 10 }];
  });
  return { name: port.name, cls: port.cls, pattern: portPatternCode(port.cls), slots };
}

export async function sectorFighters(conn: Conn, gameId: number, sector: number, lock = false) {
  const q = conn.select().from(schema.sectorFighters)
    .where(and(eq(schema.sectorFighters.gameId, gameId), eq(schema.sectorFighters.sectorId, sector)));
  const [f] = lock ? await q.for("update") : await q;
  return f ?? null;
}

type Stack = typeof schema.sectorFighters.$inferSelect;

/** Players on the same side as `p`: itself plus its corpmates. */
export async function alliesOf(conn: Conn, p: Pick<PlayerRow, "id" | "corpId">): Promise<Set<number>> {
  if (!p.corpId) return new Set([p.id]);
  const rows = await conn.select({ id: schema.players.id }).from(schema.players).where(eq(schema.players.corpId, p.corpId));
  return new Set([p.id, ...rows.map((r) => r.id)]);
}

export async function alliesOfId(conn: Conn, id: number) {
  const [p] = await conn.select({ id: schema.players.id, corpId: schema.players.corpId }).from(schema.players).where(eq(schema.players.id, id));
  return p ? alliesOf(conn, p) : new Set([id]);
}

/** Is a deployable owned by `ownerId` on p's side? Yourself, a corpmate, or (for NPCs) the same faction. */
export async function friendlyOwner(conn: Conn, p: Pick<PlayerRow, "id" | "corpId" | "npc">, ownerId: number) {
  if (ownerId === p.id) return true;
  if (!p.corpId && !p.npc) return false;
  const [o] = await conn.select({ npc: schema.players.npc, corpId: schema.players.corpId }).from(schema.players).where(eq(schema.players.id, ownerId));
  if (!o) return false;
  return (!!p.corpId && o.corpId === p.corpId) || (!!p.npc && o.npc === p.npc);
}

/** Enemy fighters stop you leaving a sector, except back the way you came (or after paying a toll). Friendly stacks never do. */
export function blockFor(s: GameSettings, p: PlayerRow, stack: Stack | null, friendly = false): SectorDto["blocked"] {
  if (!stack || stack.ownerId === p.id || stack.count <= 0 || friendly) return null;
  if (stack.mode === "toll" && p.tollPaidSector === p.sector) return null;
  const tollDue = stack.mode === "toll" ? stack.count * s.tollPerFighter : null;
  return {
    reason: stack.mode === "toll"
      ? `${stack.count} toll fighters demand ${tollDue!.toLocaleString()} credits before you move on.`
      : `${stack.count} enemy fighters block the way out.`,
    tollDue,
    backTo: p.prevSector,
  };
}

async function sectorDto(gameId: number, s: GameSettings, me: PlayerRow): Promise<SectorDto> {
  const sectorId = me.sector;
  const [sec] = await db.select().from(schema.sectors)
    .where(and(eq(schema.sectors.gameId, gameId), eq(schema.sectors.id, sectorId))).limit(1);
  if (!sec) throw new GameError("No such sector", 404);
  const [port] = await db.select().from(schema.ports)
    .where(and(eq(schema.ports.gameId, gameId), eq(schema.ports.sectorId, sectorId))).limit(1);
  // Cloaked ships don't show up for anyone else.
  const others = (await db.select().from(schema.players)
    .where(and(eq(schema.players.gameId, gameId), eq(schema.players.sector, sectorId), ne(schema.players.id, me.id))))
    .filter((o) => !o.cloaked);
  const [beacon] = await db.select({ ownerId: schema.beacons.ownerId, message: schema.beacons.message, owner: schema.players.alias })
    .from(schema.beacons).innerJoin(schema.players, eq(schema.players.id, schema.beacons.ownerId))
    .where(and(eq(schema.beacons.gameId, gameId), eq(schema.beacons.sectorId, sectorId)));
  const photon = sec.photonUntil && sec.photonUntil.getTime() > Date.now() ? sec.photonUntil.toISOString() : null;
  const stack = await sectorFighters(db, gameId, sectorId);
  let ownerAlias = "";
  if (stack) {
    const [o] = await db.select({ alias: schema.players.alias }).from(schema.players).where(eq(schema.players.id, stack.ownerId));
    ownerAlias = o?.alias ?? "Unknown";
  }
  const mines = await db.select().from(schema.sectorMines)
    .where(and(eq(schema.sectorMines.gameId, gameId), eq(schema.sectorMines.sectorId, sectorId), eq(schema.sectorMines.ownerId, me.id)));
  const adj = await adjacency(gameId);
  const allies = await alliesOf(db, me);
  const corpIds = [...new Set(others.map((o) => o.corpId).filter((c): c is number => c != null))];
  const corpInfo = new Map(corpIds.length
    ? (await db.select({ id: schema.corporations.id, name: schema.corporations.name, emblem: schema.corporations.emblem }).from(schema.corporations).where(inArray(schema.corporations.id, corpIds))).map((c) => [c.id, c] as const)
    : []);
  const friendlyStack = !!stack && allies.has(stack.ownerId);
  return {
    id: sec.id, x: sec.x, y: sec.y, fedspace: sec.fedspace, warps: adj.get(sectorId) ?? [],
    port: port ? portDto(s, port) : null,
    traders: others.map((o) => ({
      id: o.id, alias: o.alias, ship: o.ship, protected: !o.npc && sec.fedspace && fedProtected(s, o),
      corp: o.corpId ? corpInfo.get(o.corpId)?.name ?? null : null, corpEmblem: o.corpId ? corpInfo.get(o.corpId)?.emblem ?? null : null, corpmate: allies.has(o.id),
      rank: o.npc ? null : rankTitle(o.experience, o.alignment),
      npc: npcInfo(s, o, me, stack && stack.ownerId === o.id ? stack.count : 0),
    })),
    fighters: stack ? { owner: ownerAlias, mine: friendlyStack, corp: friendlyStack && stack.ownerId !== me.id, count: stack.count, mode: stack.mode } : null,
    myMines: { armid: mines.find((m) => m.kind === "armid")?.count ?? 0, limpet: mines.find((m) => m.kind === "limpet")?.count ?? 0 },
    planets: await planetSummaries(gameId, sectorId, me.id),
    homeColonists: sectorId === 1 ? await homeColonists(gameId, s) : null,
    blocked: photon ? null : blockFor(s, me, stack, friendlyStack),
    beacon: beacon ? { owner: beacon.owner, message: beacon.message, mine: beacon.ownerId === me.id } : null,
    photonUntil: photon,
  };
}

export async function getState(gameId: number, userId: number): Promise<StateDto> {
  const game = await loadGame(gameId);
  const p = await requirePlayer(gameId, userId);
  await db.update(schema.players).set({ lastSeen: new Date() }).where(eq(schema.players.id, p.id));
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.limpetTags).where(eq(schema.limpetTags.targetId, p.id));
  const player: PlayerDto = {
    id: p.id, alias: p.alias, sector: p.sector, credits: p.credits, turns: p.turns, experience: p.experience,
    alignment: p.alignment, ship: p.ship, holds: p.holds, fighters: p.fighters, shields: p.shields,
    cargo: { ore: p.cargoOre, org: p.cargoOrg, equ: p.cargoEqu },
    armids: p.armids, limpets: p.limpets, limpetsAttached: n, unread: await unreadCount(p.id, p.lastReadMessageId),
    colonists: p.cargoColonists, genesis: p.genesis, landedPlanetId: p.landedPlanetId,
    corp: null, corpInvites: [], gear: p.gear ?? {}, cloaked: p.cloaked,
    bustedAt: (await db.select().from(schema.portBusts).where(eq(schema.portBusts.playerId, p.id)))
      .filter((b) => b.until.getTime() > Date.now()).map((b) => ({ sector: b.sectorId, until: b.until.toISOString() })),
  };
  if (p.corpId) {
    const [c] = await db.select().from(schema.corporations).where(eq(schema.corporations.id, p.corpId));
    if (c) player.corp = { id: c.id, name: c.name, ceo: c.ceoId === p.id, emblem: c.emblem };
  } else {
    player.corpInvites = await db.select({ corpId: schema.corporations.id, name: schema.corporations.name, from: schema.players.alias })
      .from(schema.corpInvites).innerJoin(schema.corporations, eq(schema.corporations.id, schema.corpInvites.corpId))
      .innerJoin(schema.players, eq(schema.players.id, schema.corporations.ceoId))
      .where(eq(schema.corpInvites.playerId, p.id));
  }
  return {
    game: { id: game.id, name: game.name, sectors: game.settings.sectors, turnsPerDay: game.settings.turnsPerDay },
    player,
    sector: await sectorDto(gameId, game.settings, p),
    docked: p.docked,
  };
}

export async function getMap(gameId: number, userId: number): Promise<MapDto> {
  const p = await requirePlayer(gameId, userId);
  const adj = await adjacency(gameId);
  const seen = (await db.select({ id: schema.visited.sectorId }).from(schema.visited).where(eq(schema.visited.playerId, p.id))).map((r) => r.id);
  const visitedSet = new Set(seen);
  const known = new Set(seen);
  for (const id of seen) for (const w of adj.get(id) ?? []) known.add(w);
  const ids = [...known];
  const secs = ids.length
    ? await db.select().from(schema.sectors).where(and(eq(schema.sectors.gameId, gameId), inArray(schema.sectors.id, ids)))
    : [];
  const ports = seen.length
    ? await db.select({ sectorId: schema.ports.sectorId, cls: schema.ports.cls }).from(schema.ports)
      .where(and(eq(schema.ports.gameId, gameId), inArray(schema.ports.sectorId, seen)))
    : [];
  const portBy = new Map(ports.map((x) => [x.sectorId, portPatternCode(x.cls)]));
  return {
    current: p.sector,
    sectors: secs.map((s) => ({
      id: s.id, x: s.x, y: s.y, visited: visitedSet.has(s.id),
      port: portBy.get(s.id) ?? null,
      warps: visitedSet.has(s.id) ? adj.get(s.id) ?? [] : [],
    })),
  };
}

// ---------- ship loss ----------

/**
 * A ship is destroyed. First loss puts the pilot in an escape pod in a neighbouring sector;
 * losing the pod sends them home in a fresh starter ship with no turns left today.
 * `killer` (if any) earns XP and an alignment shift.
 */
export async function destroyShip(tx: Tx, s: GameSettings, gameId: number, victim: PlayerRow, killer: PlayerRow | null, mail: Mail, how: string) {
  const adj = await adjacency(gameId);
  const from = victim.sector;
  if (victim.npc) {
    if (victim.npc === "authority") return; // indestructible
    await npcDestroyed(tx, gameId, victim, killer, mail);
    if (killer && !killer.npc) {
      const opposite = (victim.alignment < 0) !== (killer.alignment < 0);
      const xp = s.killXpBase + Math.floor(victim.experience * (opposite ? 0.5 : 0.25));
      const align = victim.alignment >= 0 ? -s.killAlignment : s.killAlignment;
      await tx.update(schema.players).set({
        experience: sql`${schema.players.experience} + ${xp}`,
        alignment: sql`${schema.players.alignment} + ${align}`,
      }).where(eq(schema.players.id, killer.id));
      mail.to(killer.id, "combat", `+${xp} XP, alignment ${align > 0 ? "+" : ""}${align}.`);
    }
    events.emit(gameId, { kind: "combat", sector: from, alias: victim.alias, message: `${victim.alias} was destroyed in sector ${from}.` });
    return;
  }
  await tx.delete(schema.limpetTags).where(eq(schema.limpetTags.targetId, victim.id));
  const wiped = { cargoOre: 0, cargoOrg: 0, cargoEqu: 0, cargoColonists: 0, genesis: 0, landedPlanetId: null, armids: 0, limpets: 0, shields: 0, docked: false, tollPaidSector: null, gear: {}, cloaked: false };
  if (victim.ship === "escape_pod") {
    await setPlayer(tx, victim.id, { ...wiped, sector: 1, prevSector: null, ship: s.startingShip, holds: s.startingHolds, fighters: s.startingFighters, turns: 0 });
    await tx.insert(schema.visited).values({ playerId: victim.id, sectorId: 1 }).onConflictDoNothing();
    mail.to(victim.id, "combat", `${how} Your escape pod was destroyed in sector ${from}. An Authority patrol fished you out and issued a new ${SHIP_TYPES[s.startingShip]!.name} at sector 1. You're grounded until tomorrow's reset.`);
  } else {
    const exits = adj.get(from) ?? [1];
    const podTo = exits[Math.floor(Math.random() * exits.length)]!;
    await setPlayer(tx, victim.id, { ...wiped, sector: podTo, prevSector: from, ship: "escape_pod", holds: 0, fighters: 0 });
    await tx.insert(schema.visited).values({ playerId: victim.id, sectorId: podTo }).onConflictDoNothing();
    mail.to(victim.id, "combat", `${how} Your ${SHIP_TYPES[victim.ship]!.name} was destroyed in sector ${from}. You ejected in an escape pod and drifted to sector ${podTo}. Get to ${PLACE.keystone} for a new ship.`);
  }
  await payBounties(tx, victim, killer, mail);
  if (killer) {
    const opposite = (victim.alignment < 0) !== (killer.alignment < 0);
    const xp = s.killXpBase + Math.floor(victim.experience * (opposite ? 0.5 : 0.25));
    const align = victim.alignment >= 0 ? -s.killAlignment : s.killAlignment;
    await tx.update(schema.players).set({
      experience: sql`${schema.players.experience} + ${xp}`,
      alignment: sql`${schema.players.alignment} + ${align}`,
    }).where(eq(schema.players.id, killer.id));
    mail.to(killer.id, "combat", `You destroyed ${victim.alias}'s ${victim.ship === "escape_pod" ? "escape pod" : SHIP_TYPES[victim.ship]!.name} in sector ${from}. +${xp} XP, alignment ${align > 0 ? "+" : ""}${align}.`);
  }
  events.emit(gameId, { kind: "combat", sector: from, alias: victim.alias, message: `${victim.alias}'s ship was destroyed in sector ${from}.` });
}

// ---------- arrival hazards ----------

/** Mines and offensive fighters hit a ship that has just arrived. Mutates nothing outside the tx. */
async function arrivalHazards(tx: Tx, s: GameSettings, gameId: number, p: PlayerRow, mail: Mail, report: string[]): Promise<{ p: PlayerRow; destroyed: boolean }> {
  const sector = p.sector;
  const allies = await alliesOf(tx, p);
  const mines = (await tx.select().from(schema.sectorMines)
    .where(and(eq(schema.sectorMines.gameId, gameId), eq(schema.sectorMines.sectorId, sector), ne(schema.sectorMines.ownerId, p.id)))
    .for("update")).filter((m) => !allies.has(m.ownerId));
  // Limpets first, so a tag lands even if armids then cripple the ship. Escape pods are too small to trigger mines.
  mines.sort((a, b) => (a.kind === "limpet" ? -1 : 1) - (b.kind === "limpet" ? -1 : 1));
  for (const m of mines) {
    if (p.ship === "escape_pod") break;
    const where = and(eq(schema.sectorMines.gameId, gameId), eq(schema.sectorMines.sectorId, sector), eq(schema.sectorMines.ownerId, m.ownerId), eq(schema.sectorMines.kind, m.kind));
    const [owner] = await tx.select().from(schema.players).where(eq(schema.players.id, m.ownerId));
    if (m.kind === "limpet") {
      const tagged = await tx.insert(schema.limpetTags).values({ ownerId: m.ownerId, targetId: p.id }).onConflictDoNothing().returning();
      if (!tagged.length) continue;
      if (m.count <= 1) await tx.delete(schema.sectorMines).where(where);
      else await tx.update(schema.sectorMines).set({ count: m.count - 1 }).where(where);
      mail.to(m.ownerId, "limpet", `A limpet mine attached to ${p.alias}'s hull in sector ${sector}. You can track them from your Ship tab.`);
      continue;
    }
    const n = armidsTriggered(m.count, s.armidTriggerChance);
    if (!n) continue;
    const raw = applyDamage(n * s.armidDamage, p.fighters, p.shields);
    const dmg = s.minesCanDestroy ? raw : { ...raw, destroyed: false };
    if (m.count - n <= 0) await tx.delete(schema.sectorMines).where(where);
    else await tx.update(schema.sectorMines).set({ count: m.count - n }).where(where);
    report.push(`${n} burst mine${n > 1 ? "s" : ""} detonated: -${dmg.shieldsLost} shields, -${dmg.fightersLost} fighters.`);
    mail.to(m.ownerId, "combat", `${p.alias} hit ${n} of your burst mines in sector ${sector} (-${dmg.shieldsLost} shields, -${dmg.fightersLost} fighters${dmg.destroyed ? ", ship destroyed" : ""}).`);
    if (dmg.destroyed) {
      await destroyShip(tx, s, gameId, p, owner ?? null, mail, `You hit a minefield in sector ${sector}.`);
      report.push("The mines tore your ship apart.");
      return { p, destroyed: true };
    }
    p = { ...p, fighters: p.fighters - dmg.fightersLost, shields: p.shields - dmg.shieldsLost };
    await setPlayer(tx, p.id, { fighters: p.fighters, shields: p.shields });
  }

  const stack = await liveFighters(tx, gameId, sector, true);
  const hostileStack = !!stack && !allies.has(stack.ownerId) && !(p.npc && await friendlyOwner(tx, p, stack.ownerId));
  if (stack && hostileStack && stack.mode === "offensive") {
    const ship = SHIP_TYPES[p.ship]!;
    const commit = Math.min(stack.count, Math.ceil(s.offensiveCommitFactor * (ship.maxShields + ship.maxFighters)) || stack.count);
    const r = resolveCombat({ attFighters: commit, attOdds: s.sectorFighterOdds, defFighters: p.fighters, defOdds: ship.defensiveOdds, defShields: p.shields, shieldOdds: s.shieldOdds });
    const left = stack.count - r.attLost;
    const where = and(eq(schema.sectorFighters.gameId, gameId), eq(schema.sectorFighters.sectorId, sector));
    if (left <= 0) await tx.delete(schema.sectorFighters).where(where);
    else await tx.update(schema.sectorFighters).set({ count: left }).where(where);
    const [owner] = await tx.select().from(schema.players).where(eq(schema.players.id, stack.ownerId));
    report.push(p.ship === "escape_pod"
      ? `${commit} offensive fighters swarmed your escape pod.`
      : `${commit} offensive fighters attacked! You lost ${r.defFightersLost} fighters and ${r.defShieldsLost} shields; they lost ${r.attLost}.`);
    mail.to(stack.ownerId, "combat", `Your offensive fighters in sector ${sector} attacked ${p.alias}: they lost ${r.defFightersLost} fighters and ${r.defShieldsLost} shields, you lost ${r.attLost}${r.destroyed ? ". Their ship was destroyed" : ""}.`);
    if (r.destroyed) {
      await destroyShip(tx, s, gameId, p, owner ?? null, mail, `Offensive fighters swarmed you in sector ${sector}.`);
      report.push("Your ship was destroyed.");
      return { p, destroyed: true };
    }
    p = { ...p, fighters: p.fighters - r.defFightersLost, shields: p.shields - r.defShieldsLost };
    await setPlayer(tx, p.id, { fighters: p.fighters, shields: p.shields });
  }
  if (stack && hostileStack && stack.mode !== "offensive") {
    report.push(stack.mode === "toll"
      ? `${stack.count} toll fighters hail you: pay ${(stack.count * s.tollPerFighter).toLocaleString()} credits to pass.`
      : `${stack.count} defensive fighters hold this sector. Fight through them or go back.`);
    mail.to(stack.ownerId, "traffic", `${p.alias} ran into your fighters in sector ${sector}.`);
  }
  return { p, destroyed: false };
}

// ---------- movement ----------

/** One jump, for players and NPCs alike. Checks warps, turns, and blockades; applies arrival hazards. */
/** Is a photon wave knocking out fighters and weak planet defenses in this sector right now? */
export async function photonActive(conn: Conn, gameId: number, sector: number) {
  const [r] = await conn.select({ until: schema.sectors.photonUntil }).from(schema.sectors)
    .where(and(eq(schema.sectors.gameId, gameId), eq(schema.sectors.id, sector)));
  return !!r?.until && r.until.getTime() > Date.now();
}

/** Fighters that can act in a sector: none while a photon wave is up. */
export async function liveFighters(conn: Conn, gameId: number, sector: number, lock = false) {
  if (await photonActive(conn, gameId, sector)) return null;
  return sectorFighters(conn, gameId, sector, lock);
}

/** Can p leave this sector toward `to`? Throws if a blockade or an interdictor holds them. */
async function checkDeparture(tx: Tx, s: GameSettings, gameId: number, p: PlayerRow, to: number | null, mail: Mail, report: string[]) {
  const here = await liveFighters(tx, gameId, p.sector);
  const block = blockFor(s, p, here, here ? await friendlyOwner(tx, p, here.ownerId) : false);
  if (block && (to == null || to !== block.backTo)) throw new GameError(`${block.reason} You can only retreat${block.backTo ? ` to sector ${block.backTo}` : ""}.`);
  if (p.npc === "authority") return false;
  return interdicted(tx, s, gameId, p, mail, report);
}

/** Move p to `to` (already paid for) and run everything that greets a new arrival. */
async function arrive(tx: Tx, s: GameSettings, gameId: number, p: PlayerRow, to: number, patch: Partial<PlayerRow>, how: string, mail: Mail, report: string[]) {
  const from = p.sector;
  const movedPatch = { ...patch, sector: to, prevSector: from, docked: false, tollPaidSector: null, landedPlanetId: null, cloaked: false };
  await setPlayer(tx, p.id, movedPatch);
  await tx.insert(schema.visited).values({ playerId: p.id, sectorId: to }).onConflictDoNothing();
  await mailSector(tx, mail, gameId, from, p.id, "traffic", `${p.alias} ${how} out of sector ${from}.`);
  await mailSector(tx, mail, gameId, to, p.id, "traffic", `${p.alias} ${how} into sector ${to} in a ${SHIP_TYPES[p.ship]!.name}.`);
  const moved = { ...p, ...movedPatch };
  if (!p.npc) {
    const [b] = await tx.select().from(schema.beacons).where(and(eq(schema.beacons.gameId, gameId), eq(schema.beacons.sectorId, to)));
    if (b) report.push(`A marker beacon here reads: "${b.message}"`);
  }
  if (p.npc === "authority") return { from, p: moved, destroyed: false, held: false };
  const hz = await arrivalHazards(tx, s, gameId, moved, mail, report);
  if (hz.destroyed) return { from, p: hz.p, destroyed: true, held: false };
  const pd = await planetDefenses(tx, s, gameId, hz.p, mail, report);
  if (pd.destroyed || p.npc) return { from, p: pd.p, destroyed: pd.destroyed, held: false };
  const am = await npcAmbush(tx, s, gameId, pd.p, await isFedspace(tx, gameId, to), mail, report);
  return { from, p: am.p, destroyed: am.destroyed, held: false };
}

/** One jump, for players and NPCs alike. Checks warps, turns, and blockades; applies arrival hazards. */
export async function jump(tx: Tx, s: GameSettings, gameId: number, p: PlayerRow, to: number, mail: Mail, report: string[]) {
  const adj = await adjacency(gameId);
  if (!(adj.get(p.sector) ?? []).includes(to)) throw new GameError(`No warp from sector ${p.sector} to ${to}`);
  const cost = SHIP_TYPES[p.ship]!.turnsPerWarp;
  if (p.turns < cost) throw new GameError("Not enough turns left today");
  if (await checkDeparture(tx, s, gameId, p, to, mail, report)) return { from: p.sector, p, destroyed: false, held: true };
  return arrive(tx, s, gameId, p, to, { turns: p.turns - cost }, "warped", mail, report);
}

/** A TransWarp jump: any distance for a turn plus Fuel Ore per sector of the shortest route. */
export async function transwarp(gameId: number, userId: number, to: number): Promise<ActionResultDto> {
  const game = await loadGame(gameId);
  const s = game.settings;
  if (!Number.isInteger(to) || to < 1 || to > s.sectors) throw new GameError("No such sector");
  const me = await requirePlayer(gameId, userId);
  const report: string[] = [];
  const r = await withMail(gameId, async (tx, mail) => {
    const p = await lockPlayer(tx, me.id);
    if (!p.gear.transwarp || !SHIP_TYPES[p.ship]!.transwarp) throw new GameError("Your ship has no TransWarp drive");
    if (to === p.sector) throw new GameError("You're already there");
    const path = plotCourse(await adjacency(gameId), p.sector, to, 100000);
    if (!path) throw new GameError(`No route exists to sector ${to}`);
    const ore = path.length * s.transwarpOrePerSector;
    if (p.cargoOre < ore) throw new GameError(`That jump burns ${ore.toLocaleString()} Fuel Ore (${path.length} sectors); you have ${p.cargoOre.toLocaleString()}`);
    if (p.turns < s.transwarpTurns) throw new GameError("Not enough turns left today");
    if (await checkDeparture(tx, s, gameId, p, null, mail, report)) return { from: p.sector, p, destroyed: false, held: true };
    report.push(`TransWarp to sector ${to}: ${path.length} sectors, ${ore.toLocaleString()} Fuel Ore burned.`);
    return arrive(tx, s, gameId, p, to, { turns: p.turns - s.transwarpTurns, cargoOre: p.cargoOre - ore }, "TransWarped", mail, report);
  });
  if (!r.held) {
    haggles.delete(me.id);
    events.emit(gameId, { kind: "depart", sector: r.from, alias: me.alias, message: `${me.alias} TransWarped out.` });
    if (!r.destroyed) events.emit(gameId, { kind: "arrive", sector: to, alias: me.alias, ship: me.ship, message: `${me.alias} TransWarped in.` });
  }
  return { state: await getState(gameId, userId), report };
}

export async function move(gameId: number, userId: number, to: number): Promise<ActionResultDto> {
  const game = await loadGame(gameId);
  const me = await requirePlayer(gameId, userId);
  const report: string[] = [];
  const r = await withMail(gameId, async (tx, mail) => jump(tx, game.settings, gameId, await lockPlayer(tx, me.id), to, mail, report));
  if (r.held) return { state: await getState(gameId, userId), report };
  haggles.delete(me.id);
  events.emit(gameId, { kind: "depart", sector: r.from, alias: me.alias, message: `${me.alias} warped out.` });
  if (!r.destroyed) events.emit(gameId, { kind: "arrive", sector: to, alias: me.alias, ship: me.ship, message: `${me.alias} warped in.` });
  return { state: await getState(gameId, userId), report };
}

export async function course(gameId: number, userId: number, to: number) {
  const game = await loadGame(gameId);
  const p = await requirePlayer(gameId, userId);
  if (to < 1 || to > game.settings.sectors) throw new GameError("No such sector");
  const path = plotCourse(await adjacency(gameId), p.sector, to, game.settings.maxCourseLength);
  if (!path) throw new GameError(`No route to sector ${to}`);
  return { path, turns: path.length * SHIP_TYPES[p.ship]!.turnsPerWarp };
}

/** Fly a plotted course hop by hop. Stops on low turns, a blockade, enemy fighters, or ship loss. */
export async function autopilot(gameId: number, userId: number, to: number) {
  const game = await loadGame(gameId);
  const { path } = await course(gameId, userId, to);
  const me = await requirePlayer(gameId, userId);
  const report: string[] = [];
  let moved = 0;
  let final = me.sector;
  let destroyed = false;
  await withMail(gameId, async (tx, mail) => {
    let p = await lockPlayer(tx, me.id);
    for (const hop of path) {
      if (p.turns < SHIP_TYPES[p.ship]!.turnsPerWarp) { report.push("Out of turns."); break; }
      const here = await liveFighters(tx, gameId, p.sector);
      const block = blockFor(game.settings, p, here, here ? await friendlyOwner(tx, p, here.ownerId) : false);
      if (block && hop !== block.backTo) { report.push(block.reason); break; }
      const fed = await isFedspace(tx, gameId, hop);
      const hunters = (await tx.select().from(schema.players).where(and(eq(schema.players.gameId, gameId), eq(schema.players.sector, hop))))
        .filter((n) => n.npc && hostileTo(game.settings, n, p, fed));
      if (hunters.length) { report.push(`Autopilot stopped short of sector ${hop}: ${hunters[0]!.alias} is there.`); break; }
      const r = await jump(tx, game.settings, gameId, p, hop, mail, report);
      if (r.held) break;
      moved++;
      final = hop;
      if (r.destroyed) { destroyed = true; break; }
      p = r.p;
      const stack = await liveFighters(tx, gameId, hop);
      if (stack && !(await friendlyOwner(tx, p, stack.ownerId))) { report.push(`Autopilot halted: enemy fighters in sector ${hop}.`); break; }
      if ((await planetSummaries(gameId, hop, p.id, tx)).some((pl) => pl.owner && !pl.mine && pl.citadel >= 2)) {
        report.push(`Autopilot halted: a fortified enemy planet in sector ${hop}.`); break;
      }
    }
  });
  if (moved) {
    haggles.delete(me.id);
    events.emit(gameId, { kind: "depart", sector: me.sector, alias: me.alias, message: `${me.alias} warped out.` });
    if (!destroyed) events.emit(gameId, { kind: "arrive", sector: final, alias: me.alias, ship: me.ship, message: `${me.alias} warped in.` });
  }
  return { moved, planned: path.length, stoppedEarly: moved < path.length, report, state: await getState(gameId, userId) };
}

// ---------- trading ----------

/** One open negotiation per player. Held in memory: a server restart simply ends open haggles. */
const haggles = new Map<number, Haggle & { gameId: number; sector: number; expires: number }>();

export async function portHere(conn: Conn, gameId: number, sector: number, lock = false) {
  const q = conn.select().from(schema.ports).where(and(eq(schema.ports.gameId, gameId), eq(schema.ports.sectorId, sector)));
  const [port] = lock ? await q.for("update") : await q;
  return port ?? null;
}

export async function dock(gameId: number, userId: number) {
  const game = await loadGame(gameId);
  const me = await requirePlayer(gameId, userId);
  await db.transaction(async (tx) => {
    const p = await lockPlayer(tx, me.id);
    if (p.docked) return;
    const port = await portHere(tx, gameId, p.sector);
    if (!port) throw new GameError("There is no port in this sector");
    const [bust] = await tx.select().from(schema.portBusts).where(and(eq(schema.portBusts.gameId, gameId), eq(schema.portBusts.sectorId, p.sector), eq(schema.portBusts.playerId, p.id)));
    if (bust && bust.until.getTime() > Date.now()) throw new GameError(`${port.name} remembers you. They won't let you dock until ${bust.until.toLocaleDateString("en-US", { month: "short", day: "numeric" })}.`);
    if (p.turns < game.settings.portDockTurns) throw new GameError("Not enough turns left today");
    await setPlayer(tx, p.id, { docked: true, cloaked: false, turns: p.turns - game.settings.portDockTurns });
  });
  return getState(gameId, userId);
}

export async function quote(gameId: number, userId: number, commodity: Commodity, qty: number): Promise<QuoteDto> {
  const game = await loadGame(gameId);
  const s = game.settings;
  const p = await requirePlayer(gameId, userId);
  if (!p.docked) throw new GameError("Dock at the port first");
  if (!COMMODITIES.includes(commodity)) throw new GameError("Unknown commodity");
  const port = await portHere(db, gameId, p.sector);
  const slot = port?.slots[commodity];
  if (!port || !slot) throw new GameError("This port doesn't trade that");
  qty = Math.floor(qty);
  const held = p[cargoCol[commodity]];
  const free = freeHolds(p);
  const limit = maxTradeQty(slot, free, held);
  if (!Number.isSafeInteger(qty) || qty < 1 || qty > limit) throw new GameError(limit ? `You can trade 1-${limit} units here` : slot.dir === "sell" ? "No room in your holds, or the port is sold out" : "You have none to sell, or the port isn't buying");
  const total = quoteTotal(s.commodityBasePrice[commodity], slot, qty);
  if (slot.dir === "sell" && total > p.credits) throw new GameError("You can't afford that many");
  const h = startHaggle(s, slot.dir, commodity, qty, total, p.experience);
  haggles.set(p.id, { ...h, gameId, sector: p.sector, expires: Date.now() + 5 * 60_000 });
  return { commodity, dir: slot.dir, qty, quote: h.quote, rounds: 0 };
}

export async function offer(gameId: number, userId: number, amount: number): Promise<OfferResultDto> {
  const game = await loadGame(gameId);
  const s = game.settings;
  const me = await requirePlayer(gameId, userId);
  const h = haggles.get(me.id);
  if (!h || h.gameId !== gameId || h.sector !== me.sector || h.expires < Date.now()) {
    haggles.delete(me.id);
    throw new GameError("No open offer. Ask the port for a price first.");
  }
  if (!Number.isFinite(amount) || amount <= 0) throw new GameError("Offer a positive number of credits");
  const r = resolveOffer(s, h, amount);
  if (r.kind === "counter") {
    haggles.set(me.id, { ...h, ...r.haggle });
    const verb = h.dir === "sell" ? "sell them for" : "pay";
    return { result: "counter", quote: { commodity: h.commodity, dir: h.dir, qty: h.qty, quote: r.haggle.quote, rounds: r.haggle.rounds }, message: `"Not a chance. We'll ${verb} ${r.haggle.quote.toLocaleString()} credits."` };
  }
  haggles.delete(me.id);
  if (r.kind === "refused") {
    return { result: "refused", message: `"We're done here. Come back when you're serious."`, state: await getState(gameId, userId) };
  }
  await withMail(gameId, async (tx, mail) => {
    const p = await lockPlayer(tx, me.id);
    const port = await portHere(tx, gameId, p.sector, true);
    const slot = port?.slots[h.commodity];
    if (!p.docked || !port || !slot) throw new GameError("The deal fell through: you're no longer docked here");
    const col = cargoCol[h.commodity];
    const free = freeHolds(p);
    if (slot.stock < h.qty) throw new GameError("The deal fell through: the port no longer has that much");
    if (h.dir === "sell") {
      if (free < h.qty) throw new GameError("The deal fell through: not enough free holds");
      if (p.credits < r.price) throw new GameError("The deal fell through: not enough credits");
    } else if (p[col] < h.qty) throw new GameError("The deal fell through: you don't have that cargo");
    const sign = h.dir === "sell" ? 1 : -1; // +cargo -credits when buying from the port
    await setPlayer(tx, p.id, { credits: p.credits - sign * r.price, [col]: p[col] + sign * h.qty, experience: p.experience + r.xp });
    const slots = { ...port.slots, [h.commodity]: { ...slot, stock: slot.stock - h.qty } };
    await tx.update(schema.ports).set({ slots })
      .where(and(eq(schema.ports.gameId, gameId), eq(schema.ports.sectorId, port.sectorId)));
    const what = `${h.qty} ${h.commodity === "ore" ? "Fuel Ore" : h.commodity === "org" ? "Organics" : "Equipment"}`;
    mail.to(p.id, "trade", `${h.dir === "sell" ? "Bought" : "Sold"} ${what} at ${port.name} for ${r.price.toLocaleString()} credits${r.xp ? ` (+${r.xp} XP)` : ""}.`);
  });
  return { result: "accepted", price: r.price, xp: r.xp, state: await getState(gameId, userId) };
}

// ---------- daily reset ----------

export async function dailyReset(gameId: number) {
  const game = await loadGame(gameId);
  const s = game.settings;
  await withMail(gameId, async (tx, mail) => {
    await tx.update(schema.players).set({ turns: s.turnsPerDay }).where(eq(schema.players.gameId, gameId));
    const ports = await tx.select().from(schema.ports).where(eq(schema.ports.gameId, gameId)).for("update");
    for (const port of ports) {
      let changed = false;
      const slots = { ...port.slots };
      for (const c of COMMODITIES) {
        const slot = slots[c];
        if (!slot || slot.stock >= slot.max) continue;
        slots[c] = { ...slot, stock: Math.min(slot.max, slot.stock + Math.max(1, Math.round(slot.max * s.portRegenPct))) };
        changed = true;
      }
      if (changed) {
        await tx.update(schema.ports).set({ slots })
          .where(and(eq(schema.ports.gameId, gameId), eq(schema.ports.sectorId, port.sectorId)));
      }
    }
    await dailyPlanets(tx, s, gameId, mail);
    await dailyGear(tx, s, gameId, mail);
    await pruneInactive(tx, s, gameId, mail);
    const pool = game.colonistPool ?? s.colonistsStart;
    await tx.update(schema.games).set({ lastResetAt: new Date(), colonistPool: Math.min(s.colonistsMax, pool + s.colonistsRegen) }).where(eq(schema.games.id, gameId));
    const everyone = await tx.select({ id: schema.players.id }).from(schema.players).where(and(eq(schema.players.gameId, gameId), isNull(schema.players.npc)));
    for (const p of everyone) mail.to(p.id, "reset", `A new day: turns restored to ${s.turnsPerDay} and ports restocked.`);
  });
  await ensureNpcs(gameId, true);
  await pruneMessages(30);
}

// ---------- admin settings ----------

/** A flat `{ key: value }` patch from the admin panel, checked. Pct values arrive as fractions. */
export function checkedPatch(raw: unknown, creating: boolean): Partial<GameSettings> {
  if (!raw || typeof raw !== "object") return {};
  try { return validateSettingsPatch(raw as Record<string, unknown>, creating); } catch (e) { throw new GameError((e as Error).message); }
}

/** Apply an admin's changes to a running galaxy. Nothing restarts; the next action or tick reads them. */
export async function updateSettings(gameId: number, raw: unknown) {
  const game = await loadGame(gameId);
  const patch = checkedPatch(raw, false);
  const cur = game.settings;
  const next: GameSettings = {
    ...cur, ...patch,
    shipPrices: { ...cur.shipPrices, ...(patch.shipPrices ?? {}) },
    commodityBasePrice: { ...cur.commodityBasePrice, ...(patch.commodityBasePrice ?? {}) },
  };
  const problem = crossCheckSettings(next);
  if (problem) throw new GameError(problem);
  await db.update(schema.games).set({ settings: next }).where(eq(schema.games.id, gameId));
  return next;
}

export async function allGameIds() {
  return (await db.select({ id: schema.games.id }).from(schema.games)).map((g) => g.id);
}
