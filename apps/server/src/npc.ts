import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import {
  AUTHORITY_CAPTAINS, COMMODITIES, FACTIONS, MAW_WARLORD, MAW_RAIDER_PORTRAIT, SHIP_TYPES, VEY_PORTRAIT, VEY_RAIDER_HULL, VEY_TRADER_HULL, VEY_TRADER_HULLS, fedProtected, makeRng, maxTradeQty,
  quoteTotal, raiderCount, raiderName, resolveCombat, veyCount, veyName, wouldDestroy,
  type GameSettings, type NpcFaction, type NpcRole, type TraderDto,
} from "@st/shared";
import { db, schema, type Tx } from "./db";
import {
  GameError, adjacency, blockFor, destroyShip, events, jump, friendlyOwner, liveFighters, loadGame, lockPlayer, sectorFighters, setPlayer, withMail,
  type PlayerRow,
} from "./game";
import type { Mail } from "./messages";
import { corbomite } from "./gear";
import { plotCourse } from "./universe";

/**
 * NPCs are rows in `players` with `npc` set and no user. They move with the same `jump` players use,
 * so mines, offensive fighters, planet defenses, blockades, and interdictors all work on them.
 */

const rng = () => makeRng(Math.floor(Math.random() * 2 ** 31) + 1);
const chance = (p: number) => Math.random() < p;
const cargoCol = { ore: "cargoOre", org: "cargoOrg", equ: "cargoEqu" } as const;

// ---------- who's hostile to whom ----------

/** Would this NPC attack this human, given the chance? (Not the dice roll, just eligibility.) */
export function hostileTo(s: GameSettings, npc: PlayerRow, target: PlayerRow, fedspace: boolean) {
  if (target.npc || target.cloaked || target.ship === "escape_pod" || target.landedPlanetId) return false;
  if (npc.npc === "authority") return fedspace && target.sector !== 1 && target.alignment <= s.authorityHostileAlignment;
  if (fedspace && fedProtected(s, target)) return false;
  if (npc.npc === "maw") return npc.npcRole === "raider" && !(s.mawSparesNewbies && fedProtected(s, target));
  if (npc.npc === "vey") return npc.alignment < 0;
  return false;
}

function aggression(s: GameSettings, npc: PlayerRow) {
  return npc.npc === "authority" ? 1 : npc.npc === "maw" ? s.mawAggression : s.veyAggression;
}

/** Authority captains always engage; others only when they expect to destroy the target. */
function picksFight(s: GameSettings, npc: PlayerRow, target: PlayerRow) {
  if (npc.npc === "authority") return true;
  const def = SHIP_TYPES[target.ship]!;
  return wouldDestroy({ fighters: npc.fighters, odds: SHIP_TYPES[npc.ship]!.offensiveOdds }, { fighters: target.fighters, odds: def.defensiveOdds, shields: target.shields }, s.shieldOdds);
}

const factionLine = (npc: PlayerRow) => npc.npc ? FACTIONS[npc.npc].name : "";

/** What the sector panel shows about an NPC. */
export function npcInfo(s: GameSettings, npc: PlayerRow, me: PlayerRow, screen: number): TraderDto["npc"] {
  if (!npc.npc || !npc.npcRole) return null;
  const portrait = npc.npcRole === "captain" ? AUTHORITY_CAPTAINS.find((c) => c.alias === npc.alias)?.portrait ?? null
    : npc.npcRole === "warlord" ? MAW_WARLORD.portrait : npc.npc === "maw" ? MAW_RAIDER_PORTRAIT : npc.npc === "vey" ? VEY_PORTRAIT : null;
  const hostile = npc.npc === "authority" ? me.alignment <= s.authorityHostileAlignment
    : npc.npc === "maw" ? true : npc.alignment < 0;
  let attackable = true;
  let note: string | null = null;
  if (npc.npc === "authority") { attackable = false; note = "Authority cruisers can't be destroyed."; }
  else if (npc.npcRole === "warlord" && screen > 0) { attackable = false; note = `Screened by ${screen.toLocaleString()} fighters. Clear them first.`; }
  else if (npc.npc === "vey") note = npc.alignment < 0 ? "Turned raider" : "Peaceful trader";
  return { faction: npc.npc, role: npc.npcRole, portrait, hostile, attackable, note };
}

// ---------- combat ----------

/** An NPC throws all its fighters at a human. Returns true if the target was destroyed. */
export async function npcAttack(tx: Tx, s: GameSettings, gameId: number, npc: PlayerRow, target: PlayerRow, mail: Mail, report: string[] | null) {
  const att = SHIP_TYPES[npc.ship]!, def = SHIP_TYPES[target.ship]!;
  const r = resolveCombat({ attFighters: npc.fighters, attOdds: att.offensiveOdds, defFighters: target.fighters, defOdds: def.defensiveOdds, defShields: target.shields, shieldOdds: s.shieldOdds });
  if (npc.npc !== "authority") await setPlayer(tx, npc.id, { fighters: npc.fighters - r.attLost });
  const who = `${npc.alias} (${factionLine(npc)})`;
  const line = npc.npc === "authority"
    ? `${who} moved to arrest you in sector ${target.sector}. Its fighters cost you ${r.defFightersLost} fighters and ${r.defShieldsLost} shields.`
    : `${who} attacked you in sector ${target.sector}. You lost ${r.defFightersLost} fighters and ${r.defShieldsLost} shields; they lost ${r.attLost}.`;
  if (!r.destroyed) {
    await setPlayer(tx, target.id, { fighters: target.fighters - r.defFightersLost, shields: target.shields - r.defShieldsLost, docked: false });
    report?.push(line);
    mail.to(target.id, "combat", line);
  } else {
    let loot = 0;
    if (npc.npc !== "authority") {
      loot = Math.floor(target.credits * (npc.npc === "maw" ? s.mawLootPct : s.mawLootPct / 2));
      if (loot > 0) {
        await setPlayer(tx, target.id, { credits: target.credits - loot });
        await tx.update(schema.players).set({ credits: sql`${schema.players.credits} + ${loot}` }).where(eq(schema.players.id, npc.id));
      }
    }
    const how = npc.npc === "authority"
      ? `${who} destroyed your ship for crimes against the core sectors.`
      : `${who} attacked you${loot ? ` and made off with ${loot.toLocaleString()} credits` : ""}.`;
    report?.push(how, "Your ship was destroyed.");
    await destroyShip(tx, s, gameId, { ...target, credits: target.credits - loot }, npc, mail, how);
    if (npc.npc !== "authority") await corbomite(tx, s, gameId, target, { ...npc, fighters: npc.fighters - r.attLost }, mail, report);
  }
  events.emit(gameId, { kind: "combat", sector: target.sector, alias: npc.alias, message: `${npc.alias} opened fire in sector ${target.sector}!` });
  return r.destroyed;
}

/** A human has just arrived: hostile NPCs here may open fire. */
export async function npcAmbush(tx: Tx, s: GameSettings, gameId: number, p: PlayerRow, fedspace: boolean, mail: Mail, report: string[]) {
  if (!s.npcsEnabled || p.npc) return { p, destroyed: false };
  const npcs = await tx.select().from(schema.players)
    .where(and(eq(schema.players.gameId, gameId), eq(schema.players.sector, p.sector), isNotNull(schema.players.npc)))
    .for("update", { skipLocked: true }); // an NPC busy with its own turn sits this one out (no lock waits, no deadlocks)
  for (const npc of npcs) {
    if (!hostileTo(s, npc, p, fedspace) || !chance(aggression(s, npc)) || !picksFight(s, npc, p)) continue;
    const armed = npc.npc === "authority" ? { ...npc, fighters: s.authorityFighters } : npc;
    if (await npcAttack(tx, s, gameId, armed, p, mail, report)) return { p, destroyed: true };
    p = await lockPlayer(tx, p.id);
  }
  return { p, destroyed: false };
}

/** An NPC was destroyed. Its credits go to whoever did it; the row goes away (the Warlord comes back at reset). */
export async function npcDestroyed(tx: Tx, gameId: number, victim: PlayerRow, killer: PlayerRow | null, mail: Mail) {
  if (killer && !killer.npc && victim.credits > 0) {
    await tx.update(schema.players).set({ credits: sql`${schema.players.credits} + ${victim.credits}` }).where(eq(schema.players.id, killer.id));
  }
  if (killer && !killer.npc) mail.to(killer.id, "combat", `${victim.alias} (${FACTIONS[victim.npc!].name}) is destroyed.${victim.credits > 0 ? ` You recovered ${victim.credits.toLocaleString()} credits from the wreck.` : ""}`);
  if (victim.npcRole === "warlord" && killer && !killer.npc) {
    // The Warlord's fall cracks the Maw's vault.
    const [f] = await tx.select().from(schema.factions).where(and(eq(schema.factions.gameId, gameId), eq(schema.factions.faction, "maw"))).for("update");
    if (f && f.credits > 0) {
      await tx.update(schema.players).set({ credits: sql`${schema.players.credits} + ${f.credits}` }).where(eq(schema.players.id, killer.id));
      await tx.update(schema.factions).set({ credits: 0 }).where(and(eq(schema.factions.gameId, gameId), eq(schema.factions.faction, "maw")));
      mail.to(killer.id, "combat", `With ${victim.alias} dead, you cracked the Maw's vault: ${f.credits.toLocaleString()} credits.`);
    }
  }
  await tx.delete(schema.players).where(eq(schema.players.id, victim.id));
}

// ---------- population ----------

async function takenAliases(conn: Tx | typeof db, gameId: number) {
  const rows = await conn.select({ a: schema.players.alias }).from(schema.players).where(eq(schema.players.gameId, gameId));
  return new Set(rows.map((r) => r.a.toLowerCase()));
}

function uniqueName(taken: Set<string>, gen: () => string) {
  for (let i = 0; i < 30; i++) {
    const n = gen();
    if (!taken.has(n.toLowerCase())) { taken.add(n.toLowerCase()); return n; }
  }
  for (let k = 2; ; k++) {
    const n = `${gen()} ${k}`;
    if (!taken.has(n.toLowerCase())) { taken.add(n.toLowerCase()); return n; }
  }
}

async function addNpc(tx: Tx, s: GameSettings, gameId: number, v: { alias: string; faction: NpcFaction; role: NpcRole; sector: number; ship: string; fighters: number; shields: number; credits: number; alignment: number; experience?: number; holds?: number }) {
  const [p] = await tx.insert(schema.players).values({
    gameId, userId: null, alias: v.alias, npc: v.faction, npcRole: v.role, sector: v.sector, ship: v.ship,
    fighters: v.fighters, shields: v.shields, credits: v.credits, alignment: v.alignment, experience: v.experience ?? 0,
    holds: v.holds ?? SHIP_TYPES[v.ship]!.maxHolds, turns: s.turnsPerDay,
  }).returning();
  return p!;
}

/** Far from sector 1, outside FedSpace, with no port or planets: somewhere worth hunting for. */
async function pickMawHome(tx: Tx, gameId: number) {
  const adj = await adjacency(gameId);
  const dist = new Map<number, number>([[1, 0]]);
  const queue = [1];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const n of adj.get(cur) ?? []) if (!dist.has(n)) { dist.set(n, dist.get(cur)! + 1); queue.push(n); }
  }
  const fed = new Set((await tx.select({ id: schema.sectors.id }).from(schema.sectors).where(and(eq(schema.sectors.gameId, gameId), eq(schema.sectors.fedspace, true)))).map((r) => r.id));
  const busy = new Set([
    ...(await tx.select({ id: schema.ports.sectorId }).from(schema.ports).where(eq(schema.ports.gameId, gameId))).map((r) => r.id),
    ...(await tx.select({ id: schema.planets.sectorId }).from(schema.planets).where(eq(schema.planets.gameId, gameId))).map((r) => r.id),
  ]);
  const max = Math.max(...dist.values());
  let pool = [...dist.entries()].filter(([id, d]) => d >= max * 0.7 && !fed.has(id) && !busy.has(id)).map(([id]) => id);
  if (!pool.length) pool = [...dist.keys()].filter((id) => !fed.has(id));
  return rng().pick(pool);
}

async function nonFedSectors(tx: Tx, gameId: number) {
  return (await tx.select({ id: schema.sectors.id }).from(schema.sectors).where(and(eq(schema.sectors.gameId, gameId), eq(schema.sectors.fedspace, false)))).map((r) => r.id);
}

async function patrolSectors(tx: Tx, gameId: number, stardock: number) {
  const ids = (await tx.select({ id: schema.sectors.id }).from(schema.sectors).where(and(eq(schema.sectors.gameId, gameId), eq(schema.sectors.fedspace, true)))).map((r) => r.id);
  return ids.filter((id) => id !== 1 && id !== stardock);
}

/**
 * Make sure every faction is present. `restock` (first run and the daily reset) also refills the Maw's
 * home fighters, respawns a fallen Warlord, and tops raiders and Vey back up to strength.
 */
export async function ensureNpcs(gameId: number, restock: boolean) {
  const game = await loadGame(gameId);
  const s = game.settings;
  if (!s.npcsEnabled) return;
  await withMail(gameId, async (tx) => {
    // One NPC upkeep at a time per game, even with several workers.
    await tx.execute(sql`select pg_advisory_xact_lock(727002, ${gameId})`);
    const r = rng();
    const npcs = await tx.select().from(schema.players).where(and(eq(schema.players.gameId, gameId), isNotNull(schema.players.npc)));
    const taken = await takenAliases(tx, gameId);

    // The Sector Authority: named captains, re-armed every tick.
    const patrol = await patrolSectors(tx, gameId, game.stardock);
    for (const c of AUTHORITY_CAPTAINS.slice(0, s.authorityCaptains)) {
      const have = npcs.find((n) => n.npcRole === "captain" && n.alias === c.alias);
      if (have) {
        if (have.fighters !== s.authorityFighters) await setPlayer(tx, have.id, { fighters: s.authorityFighters, shields: SHIP_TYPES.authority_cruiser!.maxShields });
      } else if (patrol.length && !taken.has(c.alias.toLowerCase())) {
        taken.add(c.alias.toLowerCase());
        await addNpc(tx, s, gameId, { alias: c.alias, faction: "authority", role: "captain", sector: r.pick(patrol), ship: "authority_cruiser", fighters: s.authorityFighters, shields: SHIP_TYPES.authority_cruiser!.maxShields, credits: 0, alignment: 2000, experience: 5000 });
      }
    }

    // The Maw: a hidden home, a treasury, a Warlord, and his raiders.
    let [maw] = await tx.select().from(schema.factions).where(and(eq(schema.factions.gameId, gameId), eq(schema.factions.faction, "maw"))).for("update");
    let fresh = false;
    if (!maw) {
      [maw] = await tx.insert(schema.factions).values({ gameId, faction: "maw", homeSector: await pickMawHome(tx, gameId), credits: s.mawStartCredits }).returning();
      fresh = true;
    }
    const home = maw!.homeSector!;
    let warlord = npcs.find((n) => n.npcRole === "warlord");
    if (!warlord && (restock || fresh)) {
      warlord = await addNpc(tx, s, gameId, { alias: uniqueName(taken, () => MAW_WARLORD.alias), faction: "maw", role: "warlord", sector: home, ship: "maw_dreadnought", fighters: 3000, shields: SHIP_TYPES.maw_dreadnought!.maxShields, credits: 0, alignment: -5000, experience: 20000 });
      // A new Warlord starts with a starting treasury's worth of fighters the first time, a day's regen after a fall.
      const reserve = fresh ? s.mawStartFighters : Math.round(s.mawFighterCap * s.mawRegenPct);
      await tx.delete(schema.sectorFighters).where(and(eq(schema.sectorFighters.gameId, gameId), eq(schema.sectorFighters.sectorId, home)));
      await tx.insert(schema.sectorFighters).values({ gameId, sectorId: home, ownerId: warlord.id, count: reserve, mode: "defensive" });
    } else if (warlord && restock) {
      const stack = await sectorFighters(tx, gameId, home, true);
      const add = Math.round(s.mawFighterCap * s.mawRegenPct);
      if (!stack) await tx.insert(schema.sectorFighters).values({ gameId, sectorId: home, ownerId: warlord.id, count: add, mode: "defensive" });
      else if (stack.ownerId === warlord.id && stack.count < s.mawFighterCap) {
        await tx.update(schema.sectorFighters).set({ count: Math.min(s.mawFighterCap, stack.count + add) }).where(and(eq(schema.sectorFighters.gameId, gameId), eq(schema.sectorFighters.sectorId, home)));
      }
    }
    if ((restock || fresh) && warlord) {
      let raiders = npcs.filter((n) => n.npcRole === "raider").length;
      const stack = await sectorFighters(tx, gameId, home, true);
      let reserve = stack?.ownerId === warlord.id ? stack.count : 0;
      while (raiders < raiderCount(s)) {
        const big = r.next() < 0.2;
        const need = s.mawRaiderFighters * (big ? 2 : 1);
        if (reserve < need) break;
        reserve -= need;
        raiders++;
        const ship = big ? "maw_cruiser" : "maw_raider";
        await addNpc(tx, s, gameId, { alias: uniqueName(taken, () => raiderName(r)), faction: "maw", role: "raider", sector: home, ship, fighters: need, shields: Math.round(SHIP_TYPES[ship]!.maxShields / 2), credits: r.int(1000, 5000), alignment: -r.int(300, 900), experience: r.int(200, 2000) });
      }
      if (stack?.ownerId === warlord.id) {
        await tx.update(schema.sectorFighters).set({ count: reserve }).where(and(eq(schema.sectorFighters.gameId, gameId), eq(schema.sectorFighters.sectorId, home)));
      }
    }

    // The Vey: wandering traders, some of them hostile. Vey from before they had their own hulls get moved over.
    for (const v of npcs.filter((n) => n.npc === "vey" && !n.ship.startsWith("vey_"))) {
      const t = SHIP_TYPES[v.alignment < 0 ? VEY_RAIDER_HULL : VEY_TRADER_HULL]!;
      const used = v.cargoOre + v.cargoOrg + v.cargoEqu;
      const holds = Math.max(Math.round(t.maxHolds / 2), Math.min(used, t.maxHolds));
      const scale = used > holds ? holds / used : 1;
      await setPlayer(tx, v.id, {
        ship: t.id, holds, fighters: Math.min(v.fighters, t.maxFighters), shields: Math.min(v.shields, t.maxShields),
        cargoOre: Math.floor(v.cargoOre * scale), cargoOrg: Math.floor(v.cargoOrg * scale), cargoEqu: Math.floor(v.cargoEqu * scale),
      });
    }
    if (restock || fresh) {
      const open = await nonFedSectors(tx, gameId);
      let vey = npcs.filter((n) => n.npc === "vey").length;
      while (open.length && vey < veyCount(s)) {
        vey++;
        const evil = r.next() < s.veyEvilPct;
        const ship = evil ? VEY_RAIDER_HULL : r.pick(VEY_TRADER_HULLS);
        const t = SHIP_TYPES[ship]!;
        await addNpc(tx, s, gameId, {
          alias: uniqueName(taken, () => veyName(r)), faction: "vey", role: "trader", sector: r.pick(open), ship,
          fighters: Math.min(2000, Math.round(t.maxFighters * (0.1 + r.next() * 0.2))), shields: Math.round(t.maxShields / 2),
          credits: r.int(5000, 30000), alignment: evil ? -r.int(200, 800) : r.int(200, 800), experience: r.int(100, 3000),
          holds: Math.round(t.maxHolds / 2),
        });
      }
    }
  });
}

// ---------- the tick ----------

/** Vey trade at the port they're in: sell what the port wants, then fill up on one thing it sells. */
async function veyTrade(tx: Tx, s: GameSettings, gameId: number, v: PlayerRow) {
  const [port] = await tx.select().from(schema.ports).where(and(eq(schema.ports.gameId, gameId), eq(schema.ports.sectorId, v.sector))).for("update");
  if (!port || port.cls === 0 || port.cls === 9) return;
  const slots = { ...port.slots };
  const patch: Partial<PlayerRow> = {};
  let credits = v.credits;
  let used = v.cargoOre + v.cargoOrg + v.cargoEqu;
  for (const c of COMMODITIES) {
    const slot = slots[c];
    const held = v[cargoCol[c]];
    if (!slot || slot.dir !== "buy" || held <= 0) continue;
    const qty = maxTradeQty(slot, v.holds - used, held);
    if (qty <= 0) continue;
    credits += quoteTotal(s.commodityBasePrice[c], slot, qty);
    slots[c] = { ...slot, stock: slot.stock - qty };
    patch[cargoCol[c]] = held - qty;
    used -= qty;
  }
  const buyable = COMMODITIES.filter((c) => slots[c]?.dir === "sell" && slots[c]!.stock > 0);
  if (buyable.length) {
    const c = buyable[Math.floor(Math.random() * buyable.length)]!;
    const slot = slots[c]!;
    const held = (patch[cargoCol[c]] as number | undefined) ?? v[cargoCol[c]];
    let qty = maxTradeQty(slot, v.holds - used, held);
    while (qty > 0 && quoteTotal(s.commodityBasePrice[c], slot, qty) > credits) qty = Math.floor(qty / 2);
    if (qty > 0) {
      credits -= quoteTotal(s.commodityBasePrice[c], slot, qty);
      slots[c] = { ...slot, stock: slot.stock - qty };
      patch[cargoCol[c]] = held + qty;
    }
  }
  await tx.update(schema.ports).set({ slots }).where(and(eq(schema.ports.gameId, gameId), eq(schema.ports.sectorId, port.sectorId)));
  await setPlayer(tx, v.id, { ...patch, credits });
}

/** Where an NPC wants to go next, or null to stay put. */
async function nextHop(tx: Tx, s: GameSettings, gameId: number, npc: PlayerRow, fed: Set<number>, home: number | null, patrol: Set<number>) {
  const adj = await adjacency(gameId);
  const exits = adj.get(npc.sector) ?? [];
  if (npc.npc === "authority") {
    const ok = exits.filter((e) => patrol.has(e));
    return ok.length ? ok[Math.floor(Math.random() * ok.length)]! : null;
  }
  if (npc.npcRole === "warlord") return null;
  if (npc.npcRole === "raider" && home != null && npc.fighters < s.mawRaiderFighters * 0.3 && npc.sector !== home) {
    const path = plotCourse(adj, npc.sector, home, s.maxCourseLength);
    if (path?.length) return path[0]!;
  }
  const ok = exits.filter((e) => npc.npc === "vey" || !fed.has(e));
  return ok.length ? ok[Math.floor(Math.random() * ok.length)]! : null;
}

/** One NPC's turn: maybe move (fighting or retreating from a blockade), resupply or trade, then look for prey. */
async function actNpc(s: GameSettings, gameId: number, id: number, fed: Set<number>, home: number | null, patrol: Set<number>) {
  let departed: { from: number; to: number; alias: string; ship: string } | null = null;
  await withMail(gameId, async (tx, mail) => {
    let npc = await lockPlayer(tx, id).catch(() => null);
    if (!npc || !npc.npc) return;
    if (npc.turns < 100) { await setPlayer(tx, npc.id, { turns: s.turnsPerDay }); npc = { ...npc, turns: s.turnsPerDay }; }

    if (chance(npc.npc === "authority" ? s.npcMoveChance * 2 : s.npcMoveChance)) {
      let to = await nextHop(tx, s, gameId, npc, fed, home, patrol);
      const stack = await liveFighters(tx, gameId, npc.sector, true);
      const block = blockFor(s, npc, stack, stack ? await friendlyOwner(tx, npc, stack.ownerId) : false);
      if (to != null && block && to !== block.backTo) {
        // Blockaded: raiders try to punch through, everyone else backs off.
        const odds = SHIP_TYPES[npc.ship]!.offensiveOdds;
        if (npc.npc === "maw" && stack && npc.fighters * odds > stack.count * s.sectorFighterOdds * 1.5) {
          const r = resolveCombat({ attFighters: npc.fighters, attOdds: odds, defFighters: stack.count, defOdds: s.sectorFighterOdds, defShields: 0, shieldOdds: s.shieldOdds });
          await setPlayer(tx, npc.id, { fighters: npc.fighters - r.attLost });
          npc = { ...npc, fighters: npc.fighters - r.attLost };
          const where = and(eq(schema.sectorFighters.gameId, gameId), eq(schema.sectorFighters.sectorId, npc.sector));
          if (stack.count - r.defFightersLost <= 0) await tx.delete(schema.sectorFighters).where(where);
          else await tx.update(schema.sectorFighters).set({ count: stack.count - r.defFightersLost }).where(where);
          mail.to(stack.ownerId, "combat", `${npc.alias} (${factionLine(npc)}) tore into your fighters in sector ${npc.sector}: you lost ${r.defFightersLost}, they lost ${r.attLost}.`);
          events.emit(gameId, { kind: "combat", sector: npc.sector, alias: npc.alias, message: `${npc.alias} is fighting the sector's fighters!` });
          if (stack.count - r.defFightersLost > 0) to = null;
        } else {
          to = block.backTo;
          if (stack) mail.to(stack.ownerId, "traffic", `Your fighters in sector ${npc.sector} turned back ${npc.alias} (${factionLine(npc)}).`);
        }
      }
      if (to != null) {
        const from = npc.sector;
        const report: string[] = [];
        const r = await jump(tx, s, gameId, npc, to, mail, report).catch((e) => { if (e instanceof GameError) return null; throw e; });
        if (r && !r.held) {
          departed = { from, to, alias: npc.alias, ship: npc.ship };
          if (r.destroyed) return;
          npc = await lockPlayer(tx, npc.id);
        }
      }
    }

    // Raiders home with a thin wing draw fresh fighters from the Warlord's stack.
    if (npc.npcRole === "raider" && npc.sector === home && npc.fighters < s.mawRaiderFighters) {
      const stack = await sectorFighters(tx, gameId, home, true);
      if (stack && stack.count > 0) {
        const [owner] = await tx.select({ npc: schema.players.npc }).from(schema.players).where(eq(schema.players.id, stack.ownerId));
        if (owner?.npc === "maw") {
          const take = Math.min(stack.count, s.mawRaiderFighters - npc.fighters);
          await tx.update(schema.sectorFighters).set({ count: stack.count - take }).where(and(eq(schema.sectorFighters.gameId, gameId), eq(schema.sectorFighters.sectorId, home)));
          await setPlayer(tx, npc.id, { fighters: npc.fighters + take });
          npc = { ...npc, fighters: npc.fighters + take };
        }
      }
      // Loot goes into the vault.
      if (npc.credits > 5000) {
        await tx.update(schema.factions).set({ credits: sql`${schema.factions.credits} + ${npc.credits - 5000}` }).where(and(eq(schema.factions.gameId, gameId), eq(schema.factions.faction, "maw")));
        await setPlayer(tx, npc.id, { credits: 5000 });
        npc = { ...npc, credits: 5000 };
      }
    }
    if (npc.npc === "vey" && departed) await veyTrade(tx, s, gameId, npc);

    // Look for prey in the sector.
    const targets = await tx.select().from(schema.players)
      .where(and(eq(schema.players.gameId, gameId), eq(schema.players.sector, npc.sector), isNull(schema.players.npc)));
    const armed = npc.npc === "authority" ? { ...npc, fighters: s.authorityFighters } : npc;
    const prey = targets.filter((t) => hostileTo(s, npc!, t, fed.has(npc!.sector)) && picksFight(s, armed, t));
    if (prey.length && chance(aggression(s, npc))) {
      // Skip a player who's mid-action rather than wait on their lock.
      const [t] = await tx.select().from(schema.players).where(eq(schema.players.id, prey[Math.floor(Math.random() * prey.length)]!.id)).for("update", { skipLocked: true });
      if (t && t.sector === npc.sector && hostileTo(s, npc, t, fed.has(npc.sector))) await npcAttack(tx, s, gameId, armed, t, mail, null);
    }
  });
  if (departed) {
    const d = departed as { from: number; to: number; alias: string; ship: string };
    events.emit(gameId, { kind: "depart", sector: d.from, alias: d.alias, message: `${d.alias} warped out.` });
    events.emit(gameId, { kind: "arrive", sector: d.to, alias: d.alias, ship: d.ship, message: `${d.alias} warped in.` });
  }
}

/** Every NPC in the game gets a turn. Errors in one NPC don't stop the others. */
export async function npcTick(gameId: number) {
  const game = await loadGame(gameId);
  const s = game.settings;
  if (!s.npcsEnabled) return;
  await ensureNpcs(gameId, false);
  const fed = new Set((await db.select({ id: schema.sectors.id }).from(schema.sectors).where(and(eq(schema.sectors.gameId, gameId), eq(schema.sectors.fedspace, true)))).map((r) => r.id));
  const patrol = new Set([...fed].filter((id) => id !== 1 && id !== game.stardock));
  const [maw] = await db.select().from(schema.factions).where(and(eq(schema.factions.gameId, gameId), eq(schema.factions.faction, "maw")));
  const ids = (await db.select({ id: schema.players.id }).from(schema.players).where(and(eq(schema.players.gameId, gameId), isNotNull(schema.players.npc)))).map((r) => r.id);
  for (const id of ids.sort(() => Math.random() - 0.5)) {
    try { await actNpc(s, gameId, id, fed, maw?.homeSector ?? null, patrol); } catch (e) { console.error(`npc ${id} in game ${gameId}:`, e); }
  }
}
