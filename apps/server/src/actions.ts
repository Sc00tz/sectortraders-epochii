import { and, eq, sql } from "drizzle-orm";
import { PLACE,
  GEAR, MINE_NAME, SHIP_TYPES, fedProtected, gearDef, holdsCost, resolveCombat, type GearId,
  type ActionResultDto, type FighterMode, type LimpetTrackDto, type ShipyardEntryDto,
} from "@st/shared";
import { db, schema } from "./db";
import { corbomite } from "./gear";
import {
  GameError, destroyShip, events, friendlyOwner, getState, isFedspace, loadGame, lockPlayer, portHere, requirePlayer,
  sectorFighters, setPlayer, usedHolds, withMail, type PlayerRow,
} from "./game";

export type HardwareItem = "fighters" | "shields" | "holds" | "armid" | "limpet" | "genesis";
const ITEM_LABEL: Record<HardwareItem, string> = { fighters: "fighters", shields: "shield points", holds: "cargo holds", armid: "burst mines", limpet: "limpet mines", genesis: "Genesis torpedoes" };

async function dockedAt(p: PlayerRow, gameId: number, classes: number[], what: string) {
  if (!p.docked) throw new GameError("Dock at the port first");
  const port = await portHere(db, gameId, p.sector);
  if (!port || !classes.includes(port.cls)) throw new GameError(`${what} are only sold ${classes.includes(0) ? `at the special depots and ${PLACE.keystone}` : `at ${PLACE.keystone}`}`);
  return port;
}

// ---------- hardware ----------

export async function buyHardware(gameId: number, userId: number, requested: HardwareItem | GearId, qty: number) {
  if (gearDef(requested)) return buyGear(gameId, userId, requested as GearId, qty);
  const item = requested as HardwareItem;
  const { settings: s } = await loadGame(gameId);
  qty = Math.floor(qty);
  if (typeof item !== "string" || !Object.hasOwn(ITEM_LABEL, item)) throw new GameError("Unknown item");
  if (!(qty > 0)) throw new GameError("Buy at least one");
  const me = await requirePlayer(gameId, userId);
  await dockedAt(me, gameId, item === "armid" || item === "limpet" || item === "genesis" ? [9] : [0, 9], "Those");
  await withMail(gameId, async (tx, mail) => {
    const p = await lockPlayer(tx, me.id);
    const ship = SHIP_TYPES[p.ship]!;
    let cost = 0;
    let patch: Partial<PlayerRow> = {};
    if (item === "fighters") {
      if (p.fighters + qty > ship.maxFighters) throw new GameError(`Your ${ship.name} carries at most ${ship.maxFighters.toLocaleString()} fighters`);
      cost = qty * s.fighterPrice; patch = { fighters: p.fighters + qty };
    } else if (item === "shields") {
      if (p.shields + qty > ship.maxShields) throw new GameError(`Your ${ship.name} holds at most ${ship.maxShields.toLocaleString()} shield points`);
      cost = qty * s.shieldPrice; patch = { shields: p.shields + qty };
    } else if (item === "holds") {
      if (p.holds + qty > ship.maxHolds) throw new GameError(`Your ${ship.name} has room for at most ${ship.maxHolds} holds`);
      cost = holdsCost(s, p.holds, qty); patch = { holds: p.holds + qty };
    } else if (item === "genesis") {
      if (p.ship === "escape_pod") throw new GameError("An escape pod can't carry torpedoes");
      if (p.genesis + qty > s.maxGenesisCarried) throw new GameError(`You can carry at most ${s.maxGenesisCarried} Genesis torpedoes`);
      cost = qty * s.genesisPrice; patch = { genesis: p.genesis + qty };
    } else {
      const have = item === "armid" ? p.armids : p.limpets;
      if (p.ship === "escape_pod") throw new GameError("An escape pod can't carry mines");
      if (have + qty > s.maxMinesCarried) throw new GameError(`You can carry at most ${s.maxMinesCarried} ${ITEM_LABEL[item]}`);
      cost = qty * (item === "armid" ? s.armidPrice : s.limpetPrice);
      patch = item === "armid" ? { armids: have + qty } : { limpets: have + qty };
    }
    if (cost > p.credits) throw new GameError(`That costs ${cost.toLocaleString()} credits; you have ${p.credits.toLocaleString()}`);
    await setPlayer(tx, p.id, { ...patch, credits: p.credits - cost });
    mail.to(p.id, "shop", `Bought ${qty.toLocaleString()} ${ITEM_LABEL[item]} for ${cost.toLocaleString()} credits.`);
  });
  return getState(gameId, userId);
}

/** Equipment from the Keystone catalogue: flags are installed once, counts are carried up to a limit. */
async function buyGear(gameId: number, userId: number, id: GearId, qty: number) {
  const { settings: s } = await loadGame(gameId);
  const def = gearDef(id)!;
  qty = def.kind === "flag" ? 1 : Math.floor(qty);
  if (!(qty > 0)) throw new GameError("Buy at least one");
  const me = await requirePlayer(gameId, userId);
  await dockedAt(me, gameId, [9], "Those");
  await withMail(gameId, async (tx, mail) => {
    const p = await lockPlayer(tx, me.id);
    const ship = SHIP_TYPES[p.ship]!;
    if (p.ship === "escape_pod") throw new GameError("An escape pod can't carry equipment");
    const have = p.gear[id] ?? 0;
    if (def.kind === "flag" && have) throw new GameError(`You already have a ${def.label.toLowerCase()}`);
    if (id === "transwarp" && !ship.transwarp) throw new GameError(`A ${ship.name} isn't built for a TransWarp drive`);
    const max = def.max ? Number(s[def.max]) : 1;
    if (have + qty > max) throw new GameError(`You can carry at most ${max.toLocaleString()} ${def.label.toLowerCase()}${max === 1 ? "" : "s"}`);
    const cost = qty * Number(s[def.price]);
    if (cost > p.credits) throw new GameError(`That costs ${cost.toLocaleString()} credits; you have ${p.credits.toLocaleString()}`);
    await setPlayer(tx, p.id, { credits: p.credits - cost, gear: { ...p.gear, [id]: have + qty } });
    mail.to(p.id, "shop", `Bought ${def.kind === "flag" ? `a ${def.label}` : `${qty.toLocaleString()} ${def.label.toLowerCase()}${qty === 1 ? "" : "s"}`} for ${cost.toLocaleString()} credits.`);
  });
  return getState(gameId, userId);
}

/** Price list for the current ship, shown on the shop screen. */
export function hardwarePrices(s: Awaited<ReturnType<typeof loadGame>>["settings"], p: PlayerRow) {
  return {
    fighters: s.fighterPrice, shields: s.shieldPrice, nextHold: holdsCost(s, p.holds, 1),
    armid: s.armidPrice, limpet: s.limpetPrice, limpetRemoval: s.limpetRemovalPrice,
    genesis: s.genesisPrice, maxGenesisCarried: s.maxGenesisCarried,
    tavernPostPrice: s.tavernPostPrice, tavernRumorPrice: s.tavernRumorPrice, tavernTracePrice: s.tavernTracePrice,
    commissionAlignment: s.commissionAlignment, commissionGrant: s.commissionGrant, bountyMin: s.bountyMin,
    bountyCreditsPerAlignment: s.bountyCreditsPerAlignment, portUpgradeCostPerUnit: s.portUpgradeCostPerUnit,
    portUpgradeCreditsPerAlignment: s.portUpgradeCreditsPerAlignment, portMaxCapacity: s.portMaxCapacity,
    gear: Object.fromEntries(GEAR.map((g) => [g.id, { price: Number(s[g.price]), max: g.max ? Number(s[g.max]) : 1 }])),
    holdPriceBase: s.holdPriceBase, holdPriceStep: s.holdPriceStep, maxMinesCarried: s.maxMinesCarried,
  };
}

export async function shopInfo(gameId: number, userId: number) {
  const { settings: s } = await loadGame(gameId);
  return hardwarePrices(s, await requirePlayer(gameId, userId));
}

// ---------- shipyard ----------

function cheapestShip(prices: Record<string, number>) {
  return Math.min(...Object.values(SHIP_TYPES).filter((t) => t.buyable && !t.requires).map((t) => prices[t.id] ?? Infinity));
}

export async function shipyard(gameId: number, userId: number): Promise<ShipyardEntryDto[]> {
  const { settings: s } = await loadGame(gameId);
  const p = await requirePlayer(gameId, userId);
  const tradeIn = p.ship === "escape_pod" ? 0 : Math.floor((s.shipPrices[p.ship] ?? 0) * s.shipTradeInPct);
  const broke = p.ship === "escape_pod" && p.credits < cheapestShip(s.shipPrices);
  const [corp] = p.corpId ? await db.select({ ceoId: schema.corporations.ceoId }).from(schema.corporations).where(eq(schema.corporations.id, p.corpId)) : [];
  const isCeo = corp?.ceoId === p.id;
  return Object.values(SHIP_TYPES).filter((t) => t.buyable).map((t) => {
    let price = s.shipPrices[t.id] ?? 0;
    let reason: string | null = null;
    if (broke && t.id === s.startingShip) { price = 0; reason = "Authority replacement hull, free for stranded pilots"; }
    const net = Math.max(0, price - tradeIn);
    let available = true;
    if (t.id === p.ship) { available = false; reason = "Your current ship"; }
    else if (t.requires === "commission" && p.alignment < 1000) { available = false; reason = "Needs an Authority commission (1,000 alignment)"; }
    else if (t.requires === "corporation" && !isCeo) { available = false; reason = "Only a corporation's CEO can fly one"; }
    else if (net > p.credits) { available = false; reason = `Needs ${(net - p.credits).toLocaleString()} more credits`; }
    else if (usedHolds(p) > Math.max(s.startingHolds, Math.min(p.holds, t.maxHolds))) { available = false; reason = "Sell cargo first: it won't fit"; }
    return { id: t.id, name: t.name, price, tradeIn, net, available, reason };
  });
}

export async function buyShip(gameId: number, userId: number, shipId: string) {
  const { settings: s } = await loadGame(gameId);
  const me = await requirePlayer(gameId, userId);
  await dockedAt(me, gameId, [9], "Ships");
  const entry = (await shipyard(gameId, userId)).find((e) => e.id === shipId);
  if (!entry) throw new GameError("Unknown ship");
  if (!entry.available) throw new GameError(entry.reason ?? "You can't buy that ship");
  const t = SHIP_TYPES[shipId]!;
  await withMail(gameId, async (tx, mail) => {
    const p = await lockPlayer(tx, me.id);
    // The price and trade-in were worked out for the ship you had then; a purchase in between changes both.
    if (p.ship !== me.ship) throw new GameError("Your ship changed while that order was going through. Check the shipyard again.");
    if (entry.net > p.credits) throw new GameError("Not enough credits");
    // Holds, fighters, and shields move to the new hull up to its limits; a new hull always has the starter holds.
    const holds = Math.max(s.startingHolds, Math.min(p.holds, t.maxHolds));
    const fighters = Math.min(p.fighters, t.maxFighters);
    const shields = Math.min(p.shields, t.maxShields);
    const lost = (p.fighters - fighters) + (p.shields - shields);
    // Equipment moves to the new hull, except a TransWarp drive the new hull can't take.
    const gear = { ...p.gear };
    const droppedDrive = !!gear.transwarp && !t.transwarp;
    if (droppedDrive) delete gear.transwarp;
    await setPlayer(tx, p.id, { ship: t.id, holds, fighters, shields, credits: p.credits - entry.net, gear });
    if (droppedDrive) mail.to(p.id, "shop", `Your TransWarp drive doesn't fit a ${t.name}; the yard kept it.`);
    mail.to(p.id, "shop", `Bought a ${t.name} for ${entry.price.toLocaleString()} credits${entry.tradeIn ? ` less ${entry.tradeIn.toLocaleString()} trade-in` : ""}.${lost ? ` ${lost.toLocaleString()} fighters and shields didn't fit and were scrapped.` : ""}`);
  });
  return getState(gameId, userId);
}

export async function removeLimpets(gameId: number, userId: number) {
  const { settings: s } = await loadGame(gameId);
  const me = await requirePlayer(gameId, userId);
  await dockedAt(me, gameId, [9], "Limpet removal is");
  await withMail(gameId, async (tx, mail) => {
    const p = await lockPlayer(tx, me.id);
    const tags = await tx.select().from(schema.limpetTags).where(eq(schema.limpetTags.targetId, p.id));
    if (!tags.length) throw new GameError("There are no limpets on your hull");
    if (p.credits < s.limpetRemovalPrice) throw new GameError(`Removal costs ${s.limpetRemovalPrice.toLocaleString()} credits`);
    await tx.delete(schema.limpetTags).where(eq(schema.limpetTags.targetId, p.id));
    await setPlayer(tx, p.id, { credits: p.credits - s.limpetRemovalPrice });
    mail.to(p.id, "shop", `The ${PLACE.keystone} crew pried ${tags.length} limpet${tags.length > 1 ? "s" : ""} off your hull for ${s.limpetRemovalPrice.toLocaleString()} credits.`);
    for (const t of tags) mail.to(t.ownerId, "limpet", `Your limpet on ${p.alias} went dark: it was removed at ${PLACE.keystone}.`);
  });
  return getState(gameId, userId);
}

export async function limpetTracks(gameId: number, userId: number): Promise<LimpetTrackDto[]> {
  const p = await requirePlayer(gameId, userId);
  const rows = await db.select({ id: schema.players.id, alias: schema.players.alias, sector: schema.players.sector })
    .from(schema.limpetTags).innerJoin(schema.players, eq(schema.players.id, schema.limpetTags.targetId))
    .where(eq(schema.limpetTags.ownerId, p.id));
  return rows.map((r) => ({ targetId: r.id, alias: r.alias, sector: r.sector }));
}

// ---------- combat ----------

function spend(p: PlayerRow, turns: number) {
  if (p.turns < turns) throw new GameError("Not enough turns left today");
}

export async function attackPlayer(gameId: number, userId: number, targetId: number, fighters: number): Promise<ActionResultDto> {
  const { settings: s } = await loadGame(gameId);
  if (!Number.isInteger(targetId)) throw new GameError("Pick a trader to attack");
  const me = await requirePlayer(gameId, userId);
  const report: string[] = [];
  await withMail(gameId, async (tx, mail) => {
    // Lock both rows in id order so two traders attacking each other can't deadlock.
    const [first, second] = me.id < targetId ? [me.id, targetId] : [targetId, me.id];
    const a = await lockPlayer(tx, first), b = await lockPlayer(tx, second);
    const p = a.id === me.id ? a : b, t = a.id === me.id ? b : a;
    if (t.gameId !== gameId || t.sector !== p.sector || t.cloaked) throw new GameError("That trader isn't in this sector");
    if (t.id === p.id) throw new GameError("You can't attack yourself");
    if (p.corpId && t.corpId === p.corpId) throw new GameError(`${t.alias} is in your corporation`);
    spend(p, s.attackTurns);
    const n = Math.floor(fighters);
    if (!(n > 0) || n > p.fighters) throw new GameError(`Send between 1 and ${p.fighters} fighters`);
    if (t.npc === "authority") throw new GameError("Authority cruisers can't be destroyed, and your gunners won't waste fighters trying.");
    if (t.npcRole === "warlord") {
      const screen = await sectorFighters(tx, gameId, p.sector);
      if (screen && screen.ownerId === t.id && screen.count > 0) throw new GameError(`${t.alias} is screened by ${screen.count.toLocaleString()} fighters. Clear them first.`);
    }
    if (!t.npc && await isFedspace(tx, gameId, p.sector) && fedProtected(s, t)) throw new GameError(`The Sector Authority protects that trader in ${PLACE.core}`);
    const att = SHIP_TYPES[p.ship]!, def = SHIP_TYPES[t.ship]!;
    const r = resolveCombat({ attFighters: n, attOdds: att.offensiveOdds, defFighters: t.fighters, defOdds: def.defensiveOdds, defShields: t.shields, shieldOdds: s.shieldOdds });
    await setPlayer(tx, p.id, { fighters: p.fighters - r.attLost, turns: p.turns - s.attackTurns, docked: false, cloaked: false });
    report.push(`You sent ${n} fighters at ${t.alias}: you lost ${r.attLost}; they lost ${r.defFightersLost} fighters and ${r.defShieldsLost} shields.`);
    if (r.destroyed) {
      report.push(`${t.alias}'s ship was destroyed!`);
      await destroyShip(tx, s, gameId, t, p, mail, `${p.alias} attacked you.`);
      await corbomite(tx, s, gameId, t, { ...p, fighters: p.fighters - r.attLost }, mail, report);
    } else {
      await setPlayer(tx, t.id, { fighters: t.fighters - r.defFightersLost, shields: t.shields - r.defShieldsLost });
      if (t.npc) report.push(`${t.alias} is still flying.`);
      mail.to(t.id, "combat", `${p.alias} attacked you in sector ${p.sector} with ${n} fighters. You lost ${r.defFightersLost} fighters and ${r.defShieldsLost} shields; they lost ${r.attLost}.`);
    }
  });
  events.emit(gameId, { kind: "combat", sector: me.sector, alias: me.alias, message: `${me.alias} opened fire in sector ${me.sector}!` });
  return { state: await getState(gameId, userId), report };
}

export async function attackFighters(gameId: number, userId: number, fighters: number): Promise<ActionResultDto> {
  const { settings: s } = await loadGame(gameId);
  const me = await requirePlayer(gameId, userId);
  const report: string[] = [];
  await withMail(gameId, async (tx, mail) => {
    const p = await lockPlayer(tx, me.id);
    spend(p, s.attackTurns);
    const stack = await sectorFighters(tx, gameId, p.sector, true);
    if (!stack || await friendlyOwner(tx, p, stack.ownerId)) throw new GameError("There are no enemy fighters here");
    await setPlayer(tx, p.id, { cloaked: false });
    const n = Math.floor(fighters);
    if (!(n > 0) || n > p.fighters) throw new GameError(`Send between 1 and ${p.fighters} fighters`);
    const r = resolveCombat({ attFighters: n, attOdds: SHIP_TYPES[p.ship]!.offensiveOdds, defFighters: stack.count, defOdds: s.sectorFighterOdds, defShields: 0, shieldOdds: s.shieldOdds });
    await setPlayer(tx, p.id, { fighters: p.fighters - r.attLost, turns: p.turns - s.attackTurns });
    const where = and(eq(schema.sectorFighters.gameId, gameId), eq(schema.sectorFighters.sectorId, p.sector));
    const left = stack.count - r.defFightersLost;
    if (left <= 0) await tx.delete(schema.sectorFighters).where(where);
    else await tx.update(schema.sectorFighters).set({ count: left }).where(where);
    report.push(left <= 0
      ? `You wiped out all ${stack.count} enemy fighters, losing ${r.attLost}.`
      : `You destroyed ${r.defFightersLost} enemy fighters and lost ${r.attLost}. ${left} remain.`);
    mail.to(stack.ownerId, "combat", `${p.alias} attacked your fighters in sector ${p.sector}: you lost ${r.defFightersLost}${left <= 0 ? " (all of them)" : `, ${left} remain`}; they lost ${r.attLost}.`);
  });
  events.emit(gameId, { kind: "combat", sector: me.sector, alias: me.alias, message: `${me.alias} is fighting the sector's fighters!` });
  return { state: await getState(gameId, userId), report };
}

// ---------- deployables ----------

async function noDeployInFed(gameId: number, sector: number) {
  if (await isFedspace(db, gameId, sector)) throw new GameError(`The Sector Authority doesn't allow fighters or mines in ${PLACE.core}`);
}

export async function deployFighters(gameId: number, userId: number, count: number, mode: FighterMode) {
  const me = await requirePlayer(gameId, userId);
  if (!["defensive", "offensive", "toll"].includes(mode)) throw new GameError("Unknown fighter mode");
  await noDeployInFed(gameId, me.sector);
  await withMail(gameId, async (tx, mail) => {
    const p = await lockPlayer(tx, me.id);
    const n = Math.floor(count);
    if (!(n >= 0) || n > p.fighters) throw new GameError(`Deploy between 0 and ${p.fighters} fighters`);
    const stack = await sectorFighters(tx, gameId, p.sector, true);
    // A corpmate's stack takes your fighters too; it stays in their name.
    if (stack && !(await friendlyOwner(tx, p, stack.ownerId))) throw new GameError("Enemy fighters hold this sector. Clear them first.");
    if (!stack && n === 0) throw new GameError("Deploy at least one fighter");
    if (stack) {
      await tx.update(schema.sectorFighters).set({ count: stack.count + n, mode })
        .where(and(eq(schema.sectorFighters.gameId, gameId), eq(schema.sectorFighters.sectorId, p.sector)));
    } else {
      await tx.insert(schema.sectorFighters).values({ gameId, sectorId: p.sector, ownerId: p.id, count: n, mode });
    }
    await setPlayer(tx, p.id, { fighters: p.fighters - n });
    mail.to(p.id, "deploy", `${n ? `Deployed ${n} fighters` : "Updated your fighters"} in sector ${p.sector} (${stack ? stack.count + n : n} total, ${mode}).`);
  });
  events.emit(gameId, { kind: "deploy", sector: me.sector, alias: me.alias, message: `${me.alias} deployed fighters.` });
  return getState(gameId, userId);
}

export async function retrieveFighters(gameId: number, userId: number, count: number) {
  if (!(Math.floor(count) > 0)) throw new GameError("Enter how many fighters to take back");
  const me = await requirePlayer(gameId, userId);
  await db.transaction(async (tx) => {
    const p = await lockPlayer(tx, me.id);
    const stack = await sectorFighters(tx, gameId, p.sector, true);
    if (!stack || !(await friendlyOwner(tx, p, stack.ownerId))) throw new GameError("You have no fighters here");
    const max = SHIP_TYPES[p.ship]!.maxFighters;
    const n = Math.min(Math.floor(count), stack.count, max - p.fighters);
    if (!(n > 0)) throw new GameError("No room for more fighters on your ship");
    const where = and(eq(schema.sectorFighters.gameId, gameId), eq(schema.sectorFighters.sectorId, p.sector));
    if (stack.count - n <= 0) await tx.delete(schema.sectorFighters).where(where);
    else await tx.update(schema.sectorFighters).set({ count: stack.count - n }).where(where);
    await setPlayer(tx, p.id, { fighters: p.fighters + n });
  });
  events.emit(gameId, { kind: "deploy", sector: me.sector, alias: me.alias, message: `${me.alias} recalled fighters.` });
  return getState(gameId, userId);
}

export async function layMines(gameId: number, userId: number, kind: "armid" | "limpet", count: number) {
  const { settings: s } = await loadGame(gameId);
  if (kind !== "armid" && kind !== "limpet") throw new GameError("Unknown mine type");
  const me = await requirePlayer(gameId, userId);
  await noDeployInFed(gameId, me.sector);
  await withMail(gameId, async (tx, mail) => {
    const p = await lockPlayer(tx, me.id);
    const carried = kind === "armid" ? p.armids : p.limpets;
    const n = Math.floor(count);
    if (!(n > 0) || n > carried) throw new GameError(`You're carrying ${carried} ${MINE_NAME[kind]} mines`);
    const [{ total }] = await tx.select({ total: sql<number>`coalesce(sum(${schema.sectorMines.count}), 0)::int` }).from(schema.sectorMines)
      .where(and(eq(schema.sectorMines.gameId, gameId), eq(schema.sectorMines.sectorId, p.sector), eq(schema.sectorMines.kind, kind)));
    if (total + n > s.maxMinesPerSector) throw new GameError(`A sector holds at most ${s.maxMinesPerSector} ${MINE_NAME[kind]} mines (${total} here now)`);
    await tx.insert(schema.sectorMines).values({ gameId, sectorId: p.sector, ownerId: p.id, kind, count: n })
      .onConflictDoUpdate({
        target: [schema.sectorMines.gameId, schema.sectorMines.sectorId, schema.sectorMines.ownerId, schema.sectorMines.kind],
        set: { count: sql`${schema.sectorMines.count} + ${n}` },
      });
    await setPlayer(tx, p.id, kind === "armid" ? { armids: p.armids - n } : { limpets: p.limpets - n });
    mail.to(p.id, "deploy", `Laid ${n} ${MINE_NAME[kind]} mine${n > 1 ? "s" : ""} in sector ${p.sector}.`);
  });
  return getState(gameId, userId);
}

export async function payToll(gameId: number, userId: number) {
  const { settings: s } = await loadGame(gameId);
  const me = await requirePlayer(gameId, userId);
  await withMail(gameId, async (tx, mail) => {
    const p = await lockPlayer(tx, me.id);
    const stack = await sectorFighters(tx, gameId, p.sector, true);
    if (!stack || stack.mode !== "toll" || await friendlyOwner(tx, p, stack.ownerId)) throw new GameError("There's no toll to pay here");
    if (p.tollPaidSector === p.sector) throw new GameError("You've already paid");
    const due = stack.count * s.tollPerFighter;
    if (p.credits < due) throw new GameError(`The toll is ${due.toLocaleString()} credits`);
    await setPlayer(tx, p.id, { credits: p.credits - due, tollPaidSector: p.sector });
    await tx.update(schema.players).set({ credits: sql`${schema.players.credits} + ${due}` }).where(eq(schema.players.id, stack.ownerId));
    mail.to(p.id, "combat", `Paid a ${due.toLocaleString()} credit toll in sector ${p.sector}.`);
    mail.to(stack.ownerId, "combat", `${p.alias} paid your ${due.toLocaleString()} credit toll in sector ${p.sector}.`);
  });
  return getState(gameId, userId);
}
