import { and, eq, isNull, sql } from "drizzle-orm";
import { CORP_EMBLEMS, isCorpEmblem, type CorpDto } from "@st/shared";
import { db, schema, type Tx } from "./db";
import { GameError, getState, loadGame, lockPlayer, requirePlayer, setPlayer, withMail, type PlayerRow } from "./game";
import type { Mail } from "./messages";

/**
 * Corporations: up to `maxCorpMembers` players who share planets and deployables, a treasury, and a
 * channel in the log. The CEO invites, expels, hands over, or disbands. Mixed alignments are allowed
 * (the sources describe mixed good and evil corps).
 */

type CorpRow = typeof schema.corporations.$inferSelect;

async function lockCorp(tx: Tx, id: number) {
  const [c] = await tx.select().from(schema.corporations).where(eq(schema.corporations.id, id)).for("update");
  if (!c) throw new GameError("No such corporation", 404);
  return c;
}

async function members(conn: Tx | typeof db, corpId: number) {
  return conn.select().from(schema.players).where(eq(schema.players.corpId, corpId)).orderBy(schema.players.id);
}

async function mailCorp(tx: Tx, mail: Mail, corpId: number, text: string, except?: number) {
  for (const m of await members(tx, corpId)) if (m.id !== except) mail.to(m.id, "corp", text);
}

/** Load the caller and their corporation, both locked, and optionally insist they're its CEO. */
async function myCorp(tx: Tx, me: PlayerRow, ceoOnly = false): Promise<{ p: PlayerRow; c: CorpRow }> {
  const p = await lockPlayer(tx, me.id);
  if (!p.corpId) throw new GameError("You're not in a corporation");
  const c = await lockCorp(tx, p.corpId);
  if (ceoOnly && c.ceoId !== p.id) throw new GameError("Only the CEO can do that");
  return { p, c };
}

function cleanName(raw: string) {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!/^[A-Za-z0-9 _'&.-]{3,30}$/.test(name)) throw new GameError("Corporation names are 3-30 letters, numbers, spaces, or _ ' & . -");
  return name;
}

function idOf(n: number) {
  if (!Number.isInteger(n) || n <= 0) throw new GameError("Pick a trader");
  return n;
}

function amountOf(n: number) {
  const a = Math.floor(n);
  if (!(a > 0)) throw new GameError("Enter an amount above zero");
  return a;
}

// ---------- read ----------

export async function getCorp(gameId: number, userId: number): Promise<CorpDto | null> {
  const { settings: s } = await loadGame(gameId);
  const p = await requirePlayer(gameId, userId);
  if (!p.corpId) return null;
  const [c] = await db.select().from(schema.corporations).where(eq(schema.corporations.id, p.corpId));
  if (!c) return null;
  const list = await members(db, c.id);
  const invited = c.ceoId === p.id
    ? await db.select({ id: schema.players.id, alias: schema.players.alias }).from(schema.corpInvites)
      .innerJoin(schema.players, eq(schema.players.id, schema.corpInvites.playerId)).where(eq(schema.corpInvites.corpId, c.id))
    : [];
  return {
    id: c.id, name: c.name, ceo: list.find((m) => m.id === c.ceoId)?.alias ?? "", credits: c.credits, memo: c.memo, emblem: c.emblem,
    maxMembers: s.maxCorpMembers, invited,
    members: list.map((m) => ({ id: m.id, alias: m.alias, ship: m.ship, sector: m.sector, ceo: m.id === c.ceoId, lastSeen: m.lastSeen.toISOString() })),
  };
}

// ---------- founding and membership ----------

export async function createCorp(gameId: number, userId: number, rawName: string) {
  const name = cleanName(rawName);
  const me = await requirePlayer(gameId, userId);
  await withMail(gameId, async (tx, mail) => {
    const p = await lockPlayer(tx, me.id);
    if (p.corpId) throw new GameError("Leave your current corporation first");
    const taken = await tx.select({ id: schema.corporations.id }).from(schema.corporations)
      .where(and(eq(schema.corporations.gameId, gameId), sql`lower(${schema.corporations.name}) = lower(${name})`));
    if (taken.length) throw new GameError("A corporation with that name already exists", 409);
    const [c] = await tx.insert(schema.corporations).values({ gameId, name, ceoId: p.id }).returning();
    await setPlayer(tx, p.id, { corpId: c!.id });
    await tx.delete(schema.corpInvites).where(eq(schema.corpInvites.playerId, p.id));
    mail.to(p.id, "corp", `You founded ${name} and are its CEO. Invite traders from the Corp tab.`);
  });
  return getState(gameId, userId);
}

export async function invite(gameId: number, userId: number, alias: string) {
  const { settings: s } = await loadGame(gameId);
  const me = await requirePlayer(gameId, userId);
  await withMail(gameId, async (tx, mail) => {
    const { c } = await myCorp(tx, me, true);
    const [t] = await tx.select().from(schema.players)
      .where(and(eq(schema.players.gameId, gameId), sql`lower(${schema.players.alias}) = lower(${alias.trim()})`, isNull(schema.players.npc)));
    if (!t) throw new GameError("No trader by that name in this game");
    if (t.corpId === c.id) throw new GameError(`${t.alias} is already a member`);
    if ((await members(tx, c.id)).length >= s.maxCorpMembers) throw new GameError(`A corporation holds at most ${s.maxCorpMembers} traders`);
    const added = await tx.insert(schema.corpInvites).values({ corpId: c.id, playerId: t.id }).onConflictDoNothing().returning();
    if (!added.length) throw new GameError(`${t.alias} already has an invitation`);
    mail.to(t.id, "corp", `${me.alias} invited you to join ${c.name}. Accept or decline from the Corp tab.`);
    mail.to(me.id, "corp", `Invited ${t.alias} to ${c.name}.`);
  });
  return getCorp(gameId, userId);
}

export async function cancelInvite(gameId: number, userId: number, playerId: number) {
  playerId = idOf(playerId);
  const me = await requirePlayer(gameId, userId);
  await withMail(gameId, async (tx) => {
    const { c } = await myCorp(tx, me, true);
    await tx.delete(schema.corpInvites).where(and(eq(schema.corpInvites.corpId, c.id), eq(schema.corpInvites.playerId, playerId)));
  });
  return getCorp(gameId, userId);
}

export async function answerInvite(gameId: number, userId: number, corpId: number, accept: boolean) {
  corpId = idOf(corpId);
  const { settings: s } = await loadGame(gameId);
  const me = await requirePlayer(gameId, userId);
  await withMail(gameId, async (tx, mail) => {
    const p = await lockPlayer(tx, me.id);
    const [inv] = await tx.select().from(schema.corpInvites).where(and(eq(schema.corpInvites.corpId, corpId), eq(schema.corpInvites.playerId, p.id)));
    if (!inv) throw new GameError("That invitation is gone");
    await tx.delete(schema.corpInvites).where(and(eq(schema.corpInvites.corpId, corpId), eq(schema.corpInvites.playerId, p.id)));
    const c = await lockCorp(tx, corpId);
    if (!accept) {
      mail.to(c.ceoId, "corp", `${p.alias} declined the invitation to ${c.name}.`);
      return;
    }
    if (p.corpId) throw new GameError("Leave your current corporation first");
    if ((await members(tx, c.id)).length >= s.maxCorpMembers) throw new GameError(`${c.name} is full`);
    await setPlayer(tx, p.id, { corpId: c.id });
    await tx.delete(schema.corpInvites).where(eq(schema.corpInvites.playerId, p.id));
    await mailCorp(tx, mail, c.id, `${p.alias} joined ${c.name}.`);
  });
  return getState(gameId, userId);
}

export async function leave(gameId: number, userId: number) {
  const me = await requirePlayer(gameId, userId);
  await withMail(gameId, async (tx, mail) => {
    const { p, c } = await myCorp(tx, me);
    if (c.ceoId === p.id) throw new GameError("The CEO can't just leave: hand the corporation to another member, or disband it");
    await setPlayer(tx, p.id, { corpId: null });
    mail.to(p.id, "corp", `You left ${c.name}.`);
    await mailCorp(tx, mail, c.id, `${p.alias} left ${c.name}.`);
  });
  return getState(gameId, userId);
}

export async function expel(gameId: number, userId: number, playerId: number) {
  playerId = idOf(playerId);
  const me = await requirePlayer(gameId, userId);
  await withMail(gameId, async (tx, mail) => {
    const { p, c } = await myCorp(tx, me, true);
    if (playerId === p.id) throw new GameError("You can't expel yourself");
    const t = await lockPlayer(tx, playerId);
    if (t.corpId !== c.id) throw new GameError("That trader isn't a member");
    await setPlayer(tx, t.id, { corpId: null });
    mail.to(t.id, "corp", `${p.alias} expelled you from ${c.name}.`);
    await mailCorp(tx, mail, c.id, `${t.alias} was expelled from ${c.name}.`);
  });
  return getCorp(gameId, userId);
}

export async function handOver(gameId: number, userId: number, playerId: number) {
  playerId = idOf(playerId);
  const me = await requirePlayer(gameId, userId);
  await withMail(gameId, async (tx, mail) => {
    const { p, c } = await myCorp(tx, me, true);
    const [t] = await tx.select().from(schema.players).where(eq(schema.players.id, playerId));
    if (!t || t.corpId !== c.id || t.id === p.id) throw new GameError("Pick another member");
    await tx.update(schema.corporations).set({ ceoId: t.id }).where(eq(schema.corporations.id, c.id));
    await mailCorp(tx, mail, c.id, `${p.alias} handed ${c.name} to ${t.alias}, who is now CEO.`);
  });
  return getCorp(gameId, userId);
}

/** Members go independent; the treasury goes to the CEO. Planets and deployables stay with whoever owns them. */
export async function disband(gameId: number, userId: number) {
  const me = await requirePlayer(gameId, userId);
  await withMail(gameId, async (tx, mail) => {
    const { p, c } = await myCorp(tx, me, true);
    await mailCorp(tx, mail, c.id, `${p.alias} disbanded ${c.name}.${c.credits ? ` The treasury (${c.credits.toLocaleString()} credits) went to the CEO.` : ""}`);
    if (c.credits) await setPlayer(tx, p.id, { credits: p.credits + c.credits });
    await tx.update(schema.players).set({ corpId: null }).where(eq(schema.players.corpId, c.id));
    await tx.delete(schema.corporations).where(eq(schema.corporations.id, c.id));
  });
  return getState(gameId, userId);
}

// ---------- treasury, memo, chatter ----------

export async function deposit(gameId: number, userId: number, amount: number) {
  const a = amountOf(amount);
  const me = await requirePlayer(gameId, userId);
  await withMail(gameId, async (tx, mail) => {
    const { p, c } = await myCorp(tx, me);
    if (p.credits < a) throw new GameError(`You have ${p.credits.toLocaleString()} credits`);
    await setPlayer(tx, p.id, { credits: p.credits - a });
    await tx.update(schema.corporations).set({ credits: c.credits + a }).where(eq(schema.corporations.id, c.id));
    await mailCorp(tx, mail, c.id, `${p.alias} deposited ${a.toLocaleString()} credits in the treasury.`);
  });
  return getState(gameId, userId);
}

export async function withdraw(gameId: number, userId: number, amount: number) {
  const a = amountOf(amount);
  const me = await requirePlayer(gameId, userId);
  await withMail(gameId, async (tx, mail) => {
    const { p, c } = await myCorp(tx, me, true);
    if (c.credits < a) throw new GameError(`The treasury holds ${c.credits.toLocaleString()} credits`);
    await setPlayer(tx, p.id, { credits: p.credits + a });
    await tx.update(schema.corporations).set({ credits: c.credits - a }).where(eq(schema.corporations.id, c.id));
    await mailCorp(tx, mail, c.id, `${p.alias} withdrew ${a.toLocaleString()} credits from the treasury.`);
  });
  return getState(gameId, userId);
}

export async function setMemo(gameId: number, userId: number, memo: string) {
  const text = memo.trim().slice(0, 1000);
  const me = await requirePlayer(gameId, userId);
  await withMail(gameId, async (tx, mail) => {
    const { p, c } = await myCorp(tx, me, true);
    await tx.update(schema.corporations).set({ memo: text }).where(eq(schema.corporations.id, c.id));
    await mailCorp(tx, mail, c.id, `${p.alias} updated the corporate memo.`, p.id);
  });
  return getCorp(gameId, userId);
}

/** The CEO picks the corporation's emblem (or clears it). Each emblem flies for one corporation per galaxy. */
export async function setEmblem(gameId: number, userId: number, emblem: string | null) {
  if (emblem !== null && !isCorpEmblem(emblem)) throw new GameError("No such emblem");
  const me = await requirePlayer(gameId, userId);
  await withMail(gameId, async (tx, mail) => {
    const { p, c } = await myCorp(tx, me, true);
    if (emblem) {
      const [taken] = await tx.select({ name: schema.corporations.name }).from(schema.corporations)
        .where(and(eq(schema.corporations.gameId, gameId), eq(schema.corporations.emblem, emblem), sql`${schema.corporations.id} <> ${c.id}`));
      if (taken) throw new GameError(`${taken.name} already flies that emblem`);
    }
    await tx.update(schema.corporations).set({ emblem }).where(eq(schema.corporations.id, c.id));
    const name = CORP_EMBLEMS.find((e) => e.id === emblem)?.name.toLowerCase();
    await mailCorp(tx, mail, c.id, emblem ? `${p.alias} chose the ${name} as ${c.name}'s emblem.` : `${p.alias} took down ${c.name}'s emblem.`, p.id);
  });
  return getCorp(gameId, userId);
}

/** Emblems already taken in this galaxy, for the picker. */
export async function takenEmblems(gameId: number) {
  const rows = await db.select({ emblem: schema.corporations.emblem, name: schema.corporations.name }).from(schema.corporations)
    .where(eq(schema.corporations.gameId, gameId));
  return rows.filter((r) => r.emblem).map((r) => ({ emblem: r.emblem!, corp: r.name }));
}

export async function say(gameId: number, userId: number, text: string) {
  const line = text.trim().slice(0, 500);
  if (!line) throw new GameError("Say something");
  const me = await requirePlayer(gameId, userId);
  await withMail(gameId, async (tx, mail) => {
    const { p, c } = await myCorp(tx, me);
    await mailCorp(tx, mail, c.id, `[${c.name}] ${p.alias}: ${line}`);
  });
  return { ok: true };
}
