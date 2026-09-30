import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import {
  COMMODITIES, COMMODITY_LABEL, MINE_NAME, SHIP_TYPES, applyDamage, maxTradeQty, portPatternCode, quoteTotal,
  type ActionResultDto, type Commodity, type GameSettings, type GearId,
} from "@st/shared";
import { db, schema, type Tx } from "./db";
import {
  GameError, adjacency, destroyShip, events, friendlyOwner, getState, isFedspace, loadGame, lockPlayer, portHere,
  requirePlayer, sectorFighters, setPlayer, withMail, type PlayerRow,
} from "./game";
import type { Mail } from "./messages";
import { plotCourse } from "./universe";

/**
 * Equipment in use (scanners, probes, photons, cloaks, disruptors, beacons), the evil path at ports
 * (stealing and robbing), and the good path's taxes. Buying equipment lives in actions.ts.
 */

const need = (p: PlayerRow, id: GearId, what: string) => {
  if (!(p.gear[id] ?? 0)) throw new GameError(`You need ${what} (sold at Keystone Station)`);
};
const use = (p: PlayerRow, id: GearId) => ({ ...p.gear, [id]: Math.max(0, (p.gear[id] ?? 0) - 1) });

async function adjacentOrHere(gameId: number, p: PlayerRow, target: number, allowHere: boolean) {
  if (!Number.isInteger(target)) throw new GameError("Pick a sector");
  if (allowHere && target === p.sector) return;
  const adj = await adjacency(gameId);
  if (!(adj.get(p.sector) ?? []).includes(target)) throw new GameError(`Sector ${target} isn't next to you${allowHere ? " (or here)" : ""}`);
}

// ---------- scanners ----------

/** Relative mass in a sector, the way the original's density scanner summed it (weights are ours). */
const DENSITY = { port: 100, planet: 500, ship: 40, fighter: 5, mine: 10 } as const;

export async function densityScan(gameId: number, userId: number): Promise<ActionResultDto> {
  const p = await requirePlayer(gameId, userId);
  need(p, "density", "a density scanner");
  const adj = await adjacency(gameId);
  const exits = adj.get(p.sector) ?? [];
  const report = [`Density scan from sector ${p.sector}:`];
  for (const id of exits) {
    const port = (await db.select({ n: sql<number>`count(*)::int` }).from(schema.ports).where(and(eq(schema.ports.gameId, gameId), eq(schema.ports.sectorId, id))))[0]!.n;
    const planets = (await db.select({ n: sql<number>`count(*)::int` }).from(schema.planets).where(and(eq(schema.planets.gameId, gameId), eq(schema.planets.sectorId, id))))[0]!.n;
    const ships = (await db.select({ n: sql<number>`count(*)::int` }).from(schema.players).where(and(eq(schema.players.gameId, gameId), eq(schema.players.sector, id), eq(schema.players.cloaked, false))))[0]!.n;
    const fighters = (await sectorFighters(db, gameId, id))?.count ?? 0;
    const mines = (await db.select({ n: sql<number>`coalesce(sum(${schema.sectorMines.count}), 0)::int` }).from(schema.sectorMines).where(and(eq(schema.sectorMines.gameId, gameId), eq(schema.sectorMines.sectorId, id))))[0]!.n;
    const density = port * DENSITY.port + planets * DENSITY.planet + ships * DENSITY.ship + fighters * DENSITY.fighter + mines * DENSITY.mine;
    report.push(`Sector ${id}: density ${density.toLocaleString()}, ${(adj.get(id) ?? []).length} warps${mines ? ", anomaly detected" : ""}.`);
  }
  return { state: await getState(gameId, userId), report };
}

/** What a holo scan or a probe sees in a sector. */
async function describeSector(gameId: number, id: number, viewer: PlayerRow) {
  const [port] = await db.select().from(schema.ports).where(and(eq(schema.ports.gameId, gameId), eq(schema.ports.sectorId, id)));
  const ships = await db.select({ id: schema.players.id, alias: schema.players.alias, ship: schema.players.ship }).from(schema.players)
    .where(and(eq(schema.players.gameId, gameId), eq(schema.players.sector, id), eq(schema.players.cloaked, false), ne(schema.players.id, viewer.id)));
  const planets = await db.select({ name: schema.planets.name, cls: schema.planets.cls }).from(schema.planets).where(and(eq(schema.planets.gameId, gameId), eq(schema.planets.sectorId, id)));
  const stack = await sectorFighters(db, gameId, id);
  const [beacon] = await db.select({ message: schema.beacons.message }).from(schema.beacons).where(and(eq(schema.beacons.gameId, gameId), eq(schema.beacons.sectorId, id)));
  const bits: string[] = [];
  if (port) bits.push(port.cls === 0 || port.cls === 9 ? port.name : `${port.name} (${portPatternCode(port.cls)})`);
  if (planets.length) bits.push(`planets: ${planets.map((pl) => `${pl.name} (${pl.cls})`).join(", ")}`);
  if (ships.length) bits.push(`ships: ${ships.map((s) => `${s.alias} (${SHIP_TYPES[s.ship]?.name ?? s.ship})`).join(", ")}`);
  if (stack) {
    const [o] = await db.select({ alias: schema.players.alias }).from(schema.players).where(eq(schema.players.id, stack.ownerId));
    bits.push(`${stack.count.toLocaleString()} ${stack.mode} fighters (${o?.alias ?? "unknown"})`);
  }
  if (beacon) bits.push(`beacon: "${beacon.message}"`);
  return `Sector ${id}: ${bits.length ? bits.join("; ") : "empty space"}.`;
}

export async function holoScan(gameId: number, userId: number): Promise<ActionResultDto> {
  const { settings: s } = await loadGame(gameId);
  const me = await requirePlayer(gameId, userId);
  need(me, "holo", "a holo scanner");
  await db.transaction(async (tx) => {
    const p = await lockPlayer(tx, me.id);
    if (p.turns < s.holoScanTurns) throw new GameError("Not enough turns left today");
    await setPlayer(tx, p.id, { turns: p.turns - s.holoScanTurns });
  });
  const report = [`Holo scan from sector ${me.sector}:`];
  for (const id of (await adjacency(gameId)).get(me.sector) ?? []) report.push(await describeSector(gameId, id, me));
  return { state: await getState(gameId, userId), report };
}

/** An ether probe flies the course to `to`, logging each sector, until hostile fighters destroy it. */
export async function launchProbe(gameId: number, userId: number, to: number): Promise<ActionResultDto> {
  const { settings: s } = await loadGame(gameId);
  if (!Number.isInteger(to) || to < 1 || to > s.sectors) throw new GameError("No such sector");
  const me = await requirePlayer(gameId, userId);
  need(me, "probe", "an ether probe");
  const path = plotCourse(await adjacency(gameId), me.sector, to, s.maxCourseLength);
  if (!path || !path.length) throw new GameError(path ? "The probe is already there" : `No route to sector ${to}`);
  const report = [`Ether probe launched toward sector ${to}:`];
  await withMail(gameId, async (tx, mail) => {
    const p = await lockPlayer(tx, me.id);
    need(p, "probe", "an ether probe");
    await setPlayer(tx, p.id, { gear: use(p, "probe") });
    for (const id of path) {
      await tx.insert(schema.visited).values({ playerId: p.id, sectorId: id }).onConflictDoNothing();
      report.push(await describeSector(gameId, id, p));
      const stack = await sectorFighters(tx, gameId, id);
      if (stack && !(await friendlyOwner(tx, p, stack.ownerId))) {
        report.push(`The probe was shot down in sector ${id}.`);
        mail.to(stack.ownerId, "combat", `Your fighters in sector ${id} destroyed an ether probe.`);
        return;
      }
    }
    report.push("The probe reached its destination and self-destructed. The sectors it saw are on your map.");
  });
  return { state: await getState(gameId, userId), report };
}

// ---------- weapons and gadgets ----------

export async function firePhoton(gameId: number, userId: number, target: number): Promise<ActionResultDto> {
  const { settings: s } = await loadGame(gameId);
  const me = await requirePlayer(gameId, userId);
  need(me, "photon", "a photon missile");
  await adjacentOrHere(gameId, me, target, false);
  if (await isFedspace(db, gameId, target) || await isFedspace(db, gameId, me.sector)) throw new GameError("The Sector Authority forbids photon missiles in Core Space");
  const until = new Date(Date.now() + s.photonSeconds * 1000);
  await withMail(gameId, async (tx, mail) => {
    const p = await lockPlayer(tx, me.id);
    need(p, "photon", "a photon missile");
    await setPlayer(tx, p.id, { gear: use(p, "photon") });
    await tx.update(schema.sectors).set({ photonUntil: until }).where(and(eq(schema.sectors.gameId, gameId), eq(schema.sectors.id, target)));
    const stack = await sectorFighters(tx, gameId, target);
    if (stack && stack.ownerId !== p.id) mail.to(stack.ownerId, "combat", `A photon wave hit sector ${target}: your fighters there are out of action for ${Math.round(s.photonSeconds / 60)} minutes.`);
    const owners = await tx.select({ ownerId: schema.planets.ownerId }).from(schema.planets).where(and(eq(schema.planets.gameId, gameId), eq(schema.planets.sectorId, target)));
    for (const o of owners) if (o.ownerId && o.ownerId !== p.id) mail.to(o.ownerId, "combat", `A photon wave hit sector ${target}; planet defenses with under ${s.photonPlanetShieldLimit} shields are down for ${Math.round(s.photonSeconds / 60)} minutes.`);
  });
  events.emit(gameId, { kind: "combat", sector: target, alias: me.alias, message: "A photon wave washed over the sector!" });
  return { state: await getState(gameId, userId), report: [`Photon missile away. Fighters and weak planet defenses in sector ${target} are disabled for ${Math.round(s.photonSeconds / 60)} minutes.`] };
}

export async function engageCloak(gameId: number, userId: number) {
  const me = await requirePlayer(gameId, userId);
  await db.transaction(async (tx) => {
    const p = await lockPlayer(tx, me.id);
    if (p.cloaked) throw new GameError("You're already cloaked");
    need(p, "cloak", "a cloaking device");
    if (await isFedspace(tx, gameId, p.sector)) throw new GameError("There's no need to cloak in Core Space");
    await setPlayer(tx, p.id, { cloaked: true, docked: false, gear: use(p, "cloak") });
  });
  events.emit(gameId, { kind: "depart", sector: me.sector, alias: me.alias, message: `${me.alias} vanished from sensors.` });
  return getState(gameId, userId);
}

export async function fireDisruptor(gameId: number, userId: number, target: number): Promise<ActionResultDto> {
  const { settings: s } = await loadGame(gameId);
  const me = await requirePlayer(gameId, userId);
  need(me, "disruptor", "a mine disruptor");
  await adjacentOrHere(gameId, me, target, true);
  const report: string[] = [];
  await withMail(gameId, async (tx, mail) => {
    const p = await lockPlayer(tx, me.id);
    need(p, "disruptor", "a mine disruptor");
    await setPlayer(tx, p.id, { gear: use(p, "disruptor") });
    let left = s.disruptorMines;
    const mines = await tx.select().from(schema.sectorMines)
      .where(and(eq(schema.sectorMines.gameId, gameId), eq(schema.sectorMines.sectorId, target))).for("update");
    let cleared = 0;
    for (const m of mines) {
      if (left <= 0 || await friendlyOwner(tx, p, m.ownerId)) continue;
      const n = Math.min(left, m.count);
      left -= n; cleared += n;
      const where = and(eq(schema.sectorMines.gameId, gameId), eq(schema.sectorMines.sectorId, target), eq(schema.sectorMines.ownerId, m.ownerId), eq(schema.sectorMines.kind, m.kind));
      if (m.count - n <= 0) await tx.delete(schema.sectorMines).where(where);
      else await tx.update(schema.sectorMines).set({ count: m.count - n }).where(where);
      mail.to(m.ownerId, "combat", `${p.alias} disrupted ${n} of your ${MINE_NAME[m.kind]} mines in sector ${target}.`);
    }
    report.push(cleared ? `The disruptor cleared ${cleared} enemy mine${cleared > 1 ? "s" : ""} in sector ${target}.` : `The disruptor found no enemy mines in sector ${target}. It's spent anyway.`);
  });
  return { state: await getState(gameId, userId), report };
}

export async function placeBeacon(gameId: number, userId: number, message: string) {
  const text = message.trim().replace(/\s+/g, " ").slice(0, 80);
  if (!text) throw new GameError("Write a message for the beacon");
  const me = await requirePlayer(gameId, userId);
  need(me, "beacon", "a marker beacon");
  if (await isFedspace(db, gameId, me.sector)) throw new GameError("Beacons aren't allowed in Core Space");
  await withMail(gameId, async (tx, mail) => {
    const p = await lockPlayer(tx, me.id);
    need(p, "beacon", "a marker beacon");
    const [old] = await tx.select().from(schema.beacons).where(and(eq(schema.beacons.gameId, gameId), eq(schema.beacons.sectorId, p.sector)));
    if (old && old.ownerId !== p.id) mail.to(old.ownerId, "deploy", `${p.alias} replaced your beacon in sector ${p.sector}.`);
    await tx.insert(schema.beacons).values({ gameId, sectorId: p.sector, ownerId: p.id, message: text })
      .onConflictDoUpdate({ target: [schema.beacons.gameId, schema.beacons.sectorId], set: { ownerId: p.id, message: text, createdAt: new Date() } });
    await setPlayer(tx, p.id, { gear: use(p, "beacon") });
  });
  return getState(gameId, userId);
}

export async function removeBeacon(gameId: number, userId: number) {
  const me = await requirePlayer(gameId, userId);
  await db.delete(schema.beacons).where(and(eq(schema.beacons.gameId, gameId), eq(schema.beacons.sectorId, me.sector), eq(schema.beacons.ownerId, me.id)));
  return getState(gameId, userId);
}

/** Corbomite: when p's ship dies to `killer`, the charge goes off in the killer's face. */
export async function corbomite(tx: Tx, s: GameSettings, gameId: number, victim: PlayerRow, killer: PlayerRow, mail: Mail, report: string[] | null) {
  const units = victim.gear.corbomite ?? 0;
  if (!units || killer.npc === "authority") return;
  const k = await lockPlayer(tx, killer.id);
  const dmg = applyDamage(units * s.corbomiteDamage, k.fighters, k.shields);
  const line = `${victim.alias}'s corbomite went off: ${k.alias} lost ${dmg.shieldsLost} shields and ${dmg.fightersLost} fighters${dmg.destroyed ? " and their ship" : ""}.`;
  report?.push(line);
  mail.to(victim.id, "combat", line);
  if (dmg.destroyed) {
    await destroyShip(tx, s, gameId, k, victim, mail, `${victim.alias}'s corbomite charge tore your ship apart.`);
  } else {
    await setPlayer(tx, k.id, { fighters: k.fighters - dmg.fightersLost, shields: k.shields - dmg.shieldsLost });
    mail.to(k.id, "combat", line);
  }
}

// ---------- the evil path: stealing and robbing ----------

async function crimeScene(tx: Tx, gameId: number, p: PlayerRow, s: GameSettings) {
  if (p.alignment > s.thiefAlignment) throw new GameError(`Only pilots at ${s.thiefAlignment} alignment or lower have the nerve (and the contacts) for that`);
  if (!p.docked) throw new GameError("Dock at the port first");
  const port = await portHere(tx, gameId, p.sector, true);
  if (!port || port.cls === 0 || port.cls === 9) throw new GameError("There's nothing here you could get away with");
  if (p.turns < s.crimeTurns) throw new GameError("Not enough turns left today");
  return port;
}

/** Caught: the port confiscates holds and cargo, word spreads (experience), and it bars the door. */
async function busted(tx: Tx, s: GameSettings, gameId: number, p: PlayerRow, portName: string, mail: Mail) {
  const holdsLost = Math.max(1, Math.round(p.holds * s.bustHoldsLossPct));
  const holds = Math.max(0, p.holds - holdsLost);
  // Cargo that no longer fits goes with the confiscated holds, colonists last.
  let room = holds;
  const keep = (n: number) => { const k = Math.min(n, room); room -= k; return k; };
  const cargo = { cargoOre: keep(p.cargoOre), cargoOrg: keep(p.cargoOrg), cargoEqu: keep(p.cargoEqu), cargoColonists: keep(p.cargoColonists) };
  const xpLost = Math.floor(p.experience * s.bustXpLossPct);
  await setPlayer(tx, p.id, { holds, ...cargo, experience: p.experience - xpLost, docked: false, turns: p.turns - s.crimeTurns });
  // A port holds a grudge against one thief at a time: catching someone new clears the last.
  await tx.delete(schema.portBusts).where(and(eq(schema.portBusts.gameId, gameId), eq(schema.portBusts.sectorId, p.sector)));
  await tx.insert(schema.portBusts).values({ gameId, sectorId: p.sector, playerId: p.id, until: new Date(Date.now() + s.bustDays * 86400000) });
  const line = `Busted at ${portName}! Security confiscated ${holdsLost} cargo hold${holdsLost > 1 ? "s" : ""}${xpLost ? ` and word got around (-${xpLost} XP)` : ""}. They won't deal with you for ${s.bustDays} days.`;
  mail.to(p.id, "combat", line);
  return line;
}

export async function steal(gameId: number, userId: number, commodity: Commodity, qty: number): Promise<ActionResultDto> {
  const { settings: s } = await loadGame(gameId);
  if (!COMMODITIES.includes(commodity)) throw new GameError("Unknown commodity");
  const me = await requirePlayer(gameId, userId);
  const report: string[] = [];
  const col = ({ ore: "cargoOre", org: "cargoOrg", equ: "cargoEqu" } as const)[commodity];
  await withMail(gameId, async (tx, mail) => {
    const p = await lockPlayer(tx, me.id);
    const port = await crimeScene(tx, gameId, p, s);
    const slot = port.slots[commodity];
    if (!slot || slot.dir !== "sell") throw new GameError(`${port.name} doesn't stock ${COMMODITY_LABEL[commodity]} worth taking`);
    const limit = Math.min(Math.floor(p.experience * s.stealHoldsPerXp), p.holds - (p.cargoOre + p.cargoOrg + p.cargoEqu + p.cargoColonists), slot.stock);
    const n = Math.floor(qty);
    if (limit < 1) throw new GameError("You can't carry off anything: you need free holds, and more experience lets you take more");
    if (!(n >= 1 && n <= limit)) throw new GameError(`You can take 1-${limit} units`);
    await tx.update(schema.ports).set({ heat: port.heat + 1 }).where(and(eq(schema.ports.gameId, gameId), eq(schema.ports.sectorId, port.sectorId)));
    const odds = Math.min(0.95, s.crimeBustBase + port.heat * s.crimeBustHeat + 0.1 * (n / limit));
    if (Math.random() < odds) { report.push(await busted(tx, s, gameId, p, port.name, mail)); return; }
    await setPlayer(tx, p.id, { [col]: p[col] + n, alignment: p.alignment + s.crimeAlignment, experience: p.experience + Math.ceil(n / 10), turns: p.turns - s.crimeTurns });
    await tx.update(schema.ports).set({ slots: { ...port.slots, [commodity]: { ...slot, stock: slot.stock - n } } })
      .where(and(eq(schema.ports.gameId, gameId), eq(schema.ports.sectorId, port.sectorId)));
    report.push(`You slipped out with ${n} ${COMMODITY_LABEL[commodity]}. Alignment ${s.crimeAlignment}, +${Math.ceil(n / 10)} XP.`);
  });
  return { state: await getState(gameId, userId), report };
}

export async function rob(gameId: number, userId: number, amount: number): Promise<ActionResultDto> {
  const { settings: s } = await loadGame(gameId);
  const me = await requirePlayer(gameId, userId);
  const report: string[] = [];
  await withMail(gameId, async (tx, mail) => {
    const p = await lockPlayer(tx, me.id);
    const port = await crimeScene(tx, gameId, p, s);
    // The till holds what the port has set aside to buy goods with.
    const till = Math.floor(COMMODITIES.reduce((sum, c) => {
      const slot = port.slots[c];
      return slot && slot.dir === "buy" ? sum + quoteTotal(s.commodityBasePrice[c], slot, Math.max(0, maxTradeQty(slot, Number.MAX_SAFE_INTEGER, slot.stock))) : sum;
    }, 0));
    const limit = Math.min(Math.floor(p.experience * s.robCreditsPerXp), till);
    const a = Math.floor(amount);
    if (limit < 1) throw new GameError(till < 1 ? "The till is empty" : "You don't have the experience to pull that off yet");
    if (!(a >= 1 && a <= limit)) throw new GameError(`You can try for 1-${limit.toLocaleString()} credits`);
    await tx.update(schema.ports).set({ heat: port.heat + 1 }).where(and(eq(schema.ports.gameId, gameId), eq(schema.ports.sectorId, port.sectorId)));
    const odds = Math.min(0.95, s.crimeBustBase + port.heat * s.crimeBustHeat + 0.1 * (a / limit));
    if (Math.random() < odds) { report.push(await busted(tx, s, gameId, p, port.name, mail)); return; }
    // Money taken means the port can buy less until it restocks.
    const slots = { ...port.slots };
    for (const c of COMMODITIES) {
      const slot = slots[c];
      if (slot && slot.dir === "buy") slots[c] = { ...slot, stock: Math.floor(slot.stock * (1 - a / till)) };
    }
    await tx.update(schema.ports).set({ slots }).where(and(eq(schema.ports.gameId, gameId), eq(schema.ports.sectorId, port.sectorId)));
    const xp = Math.ceil(a / 1000);
    await setPlayer(tx, p.id, { credits: p.credits + a, alignment: p.alignment + s.crimeAlignment, experience: p.experience + xp, turns: p.turns - s.crimeTurns });
    report.push(`You cleaned out ${a.toLocaleString()} credits and walked away. Alignment ${s.crimeAlignment}, +${xp} XP.`);
  });
  return { state: await getState(gameId, userId), report };
}

/** How much a thief could try for here, for the port screen. */
export async function crimeLimits(gameId: number, userId: number) {
  const { settings: s } = await loadGame(gameId);
  const p = await requirePlayer(gameId, userId);
  const port = await portHere(db, gameId, p.sector);
  const eligible = p.alignment <= s.thiefAlignment && !!port && port.cls !== 0 && port.cls !== 9;
  return {
    eligible, thiefAlignment: s.thiefAlignment,
    stealHolds: Math.floor(p.experience * s.stealHoldsPerXp), robCredits: Math.floor(p.experience * s.robCreditsPerXp),
    heat: port?.heat ?? 0,
  };
}

// ---------- daily upkeep ----------

/** Taxes on good traders, cloak failures, bust expiry, and port heat cooling off. Runs in the daily reset. */
export async function dailyGear(tx: Tx, s: GameSettings, gameId: number, mail: Mail) {
  await tx.update(schema.ports).set({ heat: 0 }).where(eq(schema.ports.gameId, gameId));
  await tx.delete(schema.portBusts).where(and(eq(schema.portBusts.gameId, gameId), sql`${schema.portBusts.until} < now()`));
  const cloaked = await tx.select().from(schema.players).where(and(eq(schema.players.gameId, gameId), eq(schema.players.cloaked, true)));
  const failed = cloaked.filter(() => Math.random() < s.cloakFailPct);
  if (failed.length) {
    await tx.update(schema.players).set({ cloaked: false }).where(inArray(schema.players.id, failed.map((f) => f.id)));
    for (const f of failed) mail.to(f.id, "combat", `Your cloak failed overnight in sector ${f.sector}. You're visible again.`);
  }
  if (!s.taxesEnabled) return;
  const rich = await tx.select().from(schema.players).where(and(
    eq(schema.players.gameId, gameId), isNull(schema.players.npc), sql`${schema.players.alignment} >= 0`, sql`${schema.players.credits} > ${s.taxThreshold}`,
  ));
  for (const p of rich) {
    const tax = Math.floor(p.credits * s.taxPct);
    const align = Math.floor(tax / s.taxCreditsPerAlignment);
    await tx.update(schema.players).set({ credits: sql`${schema.players.credits} - ${tax}`, alignment: sql`${schema.players.alignment} + ${align}` }).where(eq(schema.players.id, p.id));
    mail.to(p.id, "reset", `The Sector Authority collected ${tax.toLocaleString()} credits in taxes (${Math.round(s.taxPct * 100)}% of your credits, since you held more than ${s.taxThreshold.toLocaleString()}). Alignment +${align}.`);
  }
}

