import { and, eq, inArray, sql } from "drizzle-orm";
import { PLACE,
  CITADEL_LEVELS, PLANET_CLASSES, SHIP_TYPES, applyDamage, citadelCost, dailyProduction, qCannonShot,
  resolveCombat, resolvePlanetAssault, rollPlanetClass,
  type ActionResultDto, type CorpPlanetDto, type GameSettings, type PlanetClassId, type PlanetDto, type PlanetSummaryDto,
} from "@st/shared";
import { db, schema, type Tx } from "./db";
import type { Mail } from "./messages";
import {
  GameError, adjacency, alliesOf, alliesOfId, destroyShip, photonActive, events, freeHolds, getState, isFedspace, loadGame, lockPlayer, requirePlayer,
  setPlayer, withMail, type PlayerRow,
} from "./game";
import { plotCourse, planetName } from "./universe";

type PlanetRow = typeof schema.planets.$inferSelect;
type Conn = Tx | typeof db;
const rng = { next: Math.random, pick: <T>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)]! };

// ---------- read models ----------

/** The owner's corporation emblem, if their corporation has one. */
async function ownerEmblem(conn: Conn, id: number | null) {
  if (!id) return null;
  const [o] = await conn.select({ emblem: schema.corporations.emblem }).from(schema.players)
    .innerJoin(schema.corporations, eq(schema.corporations.id, schema.players.corpId)).where(eq(schema.players.id, id));
  return o?.emblem ?? null;
}

async function ownerAlias(conn: Conn, id: number | null) {
  if (!id) return null;
  const [o] = await conn.select({ alias: schema.players.alias }).from(schema.players).where(eq(schema.players.id, id));
  return o?.alias ?? null;
}

export async function planetSummaries(gameId: number, sector: number, meId: number, conn: Conn = db): Promise<PlanetSummaryDto[]> {
  const rows = await conn.select().from(schema.planets)
    .where(and(eq(schema.planets.gameId, gameId), eq(schema.planets.sectorId, sector))).orderBy(schema.planets.id);
  const allies = await alliesOfId(conn, meId);
  return Promise.all(rows.map(async (p) => ({
    id: p.id, name: p.name, cls: p.cls, owner: await ownerAlias(conn, p.ownerId), ownerEmblem: await ownerEmblem(conn, p.ownerId),
    mine: !!p.ownerId && allies.has(p.ownerId), corp: !!p.ownerId && p.ownerId !== meId && allies.has(p.ownerId),
    citadel: p.citadel, shielded: p.shields > 0, interdictor: p.citadel >= 6 && p.interdictor,
  })));
}

function planetDto(pl: PlanetRow, owner: string | null, allies: Set<number>): PlanetDto {
  const cls = PLANET_CLASSES[pl.cls];
  const next = pl.citadel < 6 ? { level: pl.citadel + 1, ...citadelCost(pl.cls, pl.citadel + 1) } : null;
  return {
    id: pl.id, name: pl.name, cls: pl.cls, sector: pl.sectorId, owner, mine: !!pl.ownerId && allies.has(pl.ownerId),
    colonists: { ore: pl.colOre, org: pl.colOrg, equ: pl.colEqu }, maxColonists: cls.maxColonists,
    stock: { ore: pl.ore, org: pl.org, equ: pl.equ }, fighters: pl.fighters, shields: pl.shields, credits: pl.credits,
    citadel: pl.citadel,
    building: pl.buildDaysLeft != null ? { level: pl.citadel + 1, daysLeft: pl.buildDaysLeft } : null,
    nextLevel: next,
    production: dailyProduction(pl.cls, { ore: pl.colOre, org: pl.colOrg, equ: pl.colEqu }),
    militaryPct: pl.militaryPct, qSectorPct: pl.qSectorPct, qAtmoPct: pl.qAtmoPct, interdictor: pl.interdictor,
  };
}

async function lockPlanet(tx: Tx, id: number) {
  const [pl] = await tx.select().from(schema.planets).where(eq(schema.planets.id, id)).for("update");
  if (!pl) throw new GameError("No such planet", 404);
  return pl;
}

async function setPlanet(tx: Tx, id: number, patch: Partial<PlanetRow>) {
  await tx.update(schema.planets).set(patch).where(eq(schema.planets.id, id));
}

/** The planet you're landed on, locked, and checked to be yours. */
async function myLandedPlanet(tx: Tx, p: PlayerRow) {
  if (!p.landedPlanetId) throw new GameError("Land on a planet first");
  const pl = await lockPlanet(tx, p.landedPlanetId);
  if (pl.sectorId !== p.sector) throw new GameError("That planet isn't in this sector");
  if (!pl.ownerId || !(await alliesOf(tx, p)).has(pl.ownerId)) throw new GameError("That planet isn't yours or your corporation's");
  return pl;
}

export async function getPlanet(gameId: number, userId: number) {
  const p = await requirePlayer(gameId, userId);
  if (!p.landedPlanetId) throw new GameError("You aren't on a planet");
  const [pl] = await db.select().from(schema.planets).where(eq(schema.planets.id, p.landedPlanetId));
  if (!pl) throw new GameError("No such planet", 404);
  return planetDto(pl, await ownerAlias(db, pl.ownerId), await alliesOf(db, p));
}

/** A planet scanner reading of a planet in your sector. */
export async function scanPlanet(gameId: number, userId: number, planetId: number): Promise<PlanetDto> {
  if (!Number.isInteger(planetId)) throw new GameError("Pick a planet");
  const p = await requirePlayer(gameId, userId);
  if (!p.gear.planetScanner) throw new GameError("You need a planet scanner (sold at Keystone Station)");
  const [pl] = await db.select().from(schema.planets).where(eq(schema.planets.id, planetId));
  if (!pl || pl.gameId !== gameId || pl.sectorId !== p.sector) throw new GameError("That planet isn't in this sector");
  return planetDto(pl, await ownerAlias(db, pl.ownerId), await alliesOf(db, p));
}

/** Corporate planet scan: from a citadel, see every planet you and your corpmates own (spec: citadel level 1+). */
export async function corpPlanetScan(gameId: number, userId: number): Promise<CorpPlanetDto[]> {
  const p = await requirePlayer(gameId, userId);
  if (!p.landedPlanetId) throw new GameError("Land on one of your planets first");
  const [here] = await db.select().from(schema.planets).where(eq(schema.planets.id, p.landedPlanetId));
  const allies = await alliesOf(db, p);
  if (!here || !here.ownerId || !allies.has(here.ownerId)) throw new GameError("You need to be on your own or your corporation's planet");
  if (here.citadel < 1) throw new GameError("Scanning needs a citadel (level 1 or higher) on this planet");
  const rows = await db.select().from(schema.planets).where(and(eq(schema.planets.gameId, gameId), inArray(schema.planets.ownerId, [...allies]))).orderBy(schema.planets.sectorId);
  const names = new Map((await db.select({ id: schema.players.id, alias: schema.players.alias }).from(schema.players).where(inArray(schema.players.id, [...allies]))).map((r) => [r.id, r.alias]));
  return rows.map((pl) => ({
    id: pl.id, name: pl.name, cls: pl.cls, sector: pl.sectorId, owner: names.get(pl.ownerId!) ?? "", citadel: pl.citadel, building: pl.buildDaysLeft != null,
    fighters: pl.fighters, shields: pl.shields, colonists: pl.colOre + pl.colOrg + pl.colEqu,
    stock: { ore: pl.ore, org: pl.org, equ: pl.equ }, credits: pl.credits,
  }));
}

/** Atomic detonator: destroy the planet you're landed on. It has to be yours (or taken) first. */
export async function detonate(gameId: number, userId: number) {
  const { settings: s } = await loadGame(gameId);
  const me = await requirePlayer(gameId, userId);
  const report: string[] = [];
  await withMail(gameId, async (tx, mail) => {
    const p = await lockPlayer(tx, me.id);
    if (!(p.gear.detonator ?? 0)) throw new GameError("You have no atomic detonators");
    const pl = await myLandedPlanet(tx, p);
    const others = await tx.select({ id: schema.players.id }).from(schema.players).where(eq(schema.players.landedPlanetId, pl.id));
    await tx.update(schema.players).set({ landedPlanetId: null }).where(eq(schema.players.landedPlanetId, pl.id));
    await tx.delete(schema.planets).where(eq(schema.planets.id, pl.id));
    await setPlayer(tx, p.id, { landedPlanetId: null, gear: { ...p.gear, detonator: (p.gear.detonator ?? 1) - 1 }, alignment: p.alignment + s.detonatorAlignment });
    report.push(`${pl.name} is gone. Alignment ${s.detonatorAlignment}.`);
    mail.to(p.id, "planet", `You detonated ${pl.name} in sector ${pl.sectorId}.`);
    if (pl.ownerId && pl.ownerId !== p.id) mail.to(pl.ownerId, "planet", `${p.alias} destroyed your planet ${pl.name} in sector ${pl.sectorId} with an atomic detonator.`);
    for (const o of others) if (o.id !== p.id) mail.to(o.id, "planet", `${pl.name} was destroyed under you; you're back in your ship.`);
  });
  events.emit(gameId, { kind: "combat", sector: me.sector, alias: me.alias, message: `${me.alias} destroyed a planet.` });
  return { state: await getState(gameId, userId), report };
}

// ---------- arrival defenses and interdiction ----------

/** An enemy fortress in the sector hits a ship that just arrived: military reaction, then the sector Q-cannon. */
export async function planetDefenses(tx: Tx, s: GameSettings, gameId: number, p: PlayerRow, mail: Mail, report: string[]) {
  if (p.ship === "escape_pod") return { p, destroyed: false };
  const rows = await tx.select().from(schema.planets)
    .where(and(eq(schema.planets.gameId, gameId), eq(schema.planets.sectorId, p.sector))).for("update");
  const allies = await alliesOf(tx, p);
  const photon = await photonActive(tx, gameId, p.sector);
  for (const pl of rows) {
    if (!pl.ownerId || allies.has(pl.ownerId)) continue;
    if (photon && pl.shields < s.photonPlanetShieldLimit) continue; // knocked out by a photon wave
    const [owner] = await tx.select().from(schema.players).where(eq(schema.players.id, pl.ownerId));
    const ship = SHIP_TYPES[p.ship]!;
    if (pl.citadel >= 2 && pl.militaryPct > 0 && pl.fighters > 0) {
      const commit = Math.floor((pl.fighters * pl.militaryPct) / 100);
      if (commit > 0) {
        const r = resolveCombat({ attFighters: commit, attOdds: s.planetOffensiveOdds, defFighters: p.fighters, defOdds: ship.defensiveOdds, defShields: p.shields, shieldOdds: s.shieldOdds });
        await setPlanet(tx, pl.id, { fighters: pl.fighters - r.attLost });
        report.push(`${pl.name} launched ${commit} fighters at you: you lost ${r.defFightersLost} fighters and ${r.defShieldsLost} shields; it lost ${r.attLost}.`);
        mail.to(pl.ownerId, "combat", `${pl.name} (sector ${p.sector}) attacked ${p.alias} with ${commit} fighters: they lost ${r.defFightersLost} fighters and ${r.defShieldsLost} shields, you lost ${r.attLost}${r.destroyed ? ". Their ship was destroyed" : ""}.`);
        if (r.destroyed) {
          await destroyShip(tx, s, gameId, p, owner ?? null, mail, `${pl.name}'s defenses shot you down in sector ${p.sector}.`);
          report.push("Your ship was destroyed.");
          return { p, destroyed: true };
        }
        p = { ...p, fighters: p.fighters - r.defFightersLost, shields: p.shields - r.defShieldsLost };
        await setPlayer(tx, p.id, { fighters: p.fighters, shields: p.shields });
      }
    }
    if (pl.citadel >= 3 && pl.qSectorPct > 0 && pl.ore > 0) {
      const shot = qCannonShot(pl.ore, pl.qSectorPct, "sector", s.qAtmoMultiplier);
      if (shot.damage > 0) {
        const dmg = applyDamage(shot.damage, p.fighters, p.shields);
        await setPlanet(tx, pl.id, { ore: pl.ore - shot.burned });
        report.push(`${pl.name}'s Quasar Cannon fired: -${dmg.shieldsLost} shields, -${dmg.fightersLost} fighters.`);
        mail.to(pl.ownerId, "combat", `${pl.name}'s Quasar Cannon fired on ${p.alias} in sector ${p.sector} for ${shot.damage} damage (${shot.burned} Fuel Ore burned)${dmg.destroyed ? ", destroying their ship" : ""}.`);
        if (dmg.destroyed) {
          await destroyShip(tx, s, gameId, p, owner ?? null, mail, `${pl.name}'s Quasar Cannon hit you in sector ${p.sector}.`);
          report.push("Your ship was destroyed.");
          return { p, destroyed: true };
        }
        p = { ...p, fighters: p.fighters - dmg.fightersLost, shields: p.shields - dmg.shieldsLost };
        await setPlayer(tx, p.id, { fighters: p.fighters, shields: p.shields });
      }
    }
  }
  return { p, destroyed: false };
}

/** An enemy Interdictor Generator in this sector stops the ship leaving (burning Fuel Ore per attempt). */
export async function interdicted(tx: Tx, s: GameSettings, gameId: number, p: PlayerRow, mail: Mail, report: string[]) {
  if (p.ship === "escape_pod") return false;
  const rows = await tx.select().from(schema.planets)
    .where(and(eq(schema.planets.gameId, gameId), eq(schema.planets.sectorId, p.sector))).for("update");
  const allies = await alliesOf(tx, p);
  const photon = await photonActive(tx, gameId, p.sector);
  for (const pl of rows) {
    if (photon && pl.shields < s.photonPlanetShieldLimit) continue;
    if (!pl.ownerId || allies.has(pl.ownerId) || pl.citadel < 6 || !pl.interdictor || pl.ore < s.interdictorOre) continue;
    await setPlanet(tx, pl.id, { ore: pl.ore - s.interdictorOre });
    report.push(`${pl.name}'s interdictor field holds your ship in place. Destroy its defenses or wait until its Fuel Ore runs out.`);
    mail.to(pl.ownerId, "combat", `${pl.name}'s interdictor held ${p.alias} in sector ${p.sector} (${s.interdictorOre} Fuel Ore used).`);
    return true;
  }
  return false;
}

// ---------- daily ----------

export async function dailyPlanets(tx: Tx, s: GameSettings, gameId: number, mail: Mail) {
  const rows = await tx.select().from(schema.planets).where(eq(schema.planets.gameId, gameId)).for("update");
  for (const pl of rows) {
    if (!pl.ownerId) continue;
    const out = dailyProduction(pl.cls, { ore: pl.colOre, org: pl.colOrg, equ: pl.colEqu });
    const patch: Partial<PlanetRow> = {
      ore: pl.ore + out.ore, org: pl.org + out.org, equ: pl.equ + out.equ, fighters: pl.fighters + out.fighters,
    };
    if (pl.citadel >= 1 && pl.credits > 0) patch.credits = pl.credits + Math.floor(pl.credits * s.treasuryInterestPct);
    if (pl.buildDaysLeft != null) {
      if (pl.buildDaysLeft <= 1) {
        patch.citadel = pl.citadel + 1;
        patch.buildDaysLeft = null;
        const lvl = CITADEL_LEVELS[pl.citadel]!;
        mail.to(pl.ownerId, "planet", `${pl.name} completed citadel level ${lvl.level}: ${lvl.name}. ${lvl.adds}.`);
      } else {
        patch.buildDaysLeft = pl.buildDaysLeft - 1;
      }
    }
    await setPlanet(tx, pl.id, patch);
  }
}

// ---------- actions ----------

export async function launchGenesis(gameId: number, userId: number, name: string): Promise<ActionResultDto> {
  const { settings: s } = await loadGame(gameId);
  const me = await requirePlayer(gameId, userId);
  name = name.trim() || planetName(rng);
  if (!/^[A-Za-z0-9 _'-]{2,30}$/.test(name)) throw new GameError("Planet names are 2-30 letters, numbers, spaces, _ ' or -");
  if (await isFedspace(db, gameId, me.sector)) throw new GameError(`The Sector Authority doesn't allow new planets in ${PLACE.core}`);
  const report: string[] = [];
  await withMail(gameId, async (tx, mail) => {
    const p = await lockPlayer(tx, me.id);
    if (p.genesis < 1) throw new GameError(`You have no Genesis torpedoes. ${PLACE.keystone} sells them.`);
    if (p.turns < s.genesisTurns) throw new GameError("Not enough turns left today");
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.planets)
      .where(and(eq(schema.planets.gameId, gameId), eq(schema.planets.sectorId, p.sector)));
    if (n >= s.maxPlanetsPerSector) throw new GameError(`This sector already has ${n} planets, the most it can hold`);
    const cls = rollPlanetClass();
    const [pl] = await tx.insert(schema.planets).values({ gameId, sectorId: p.sector, name, cls, ownerId: p.id }).returning();
    await setPlayer(tx, p.id, { genesis: p.genesis - 1, turns: p.turns - s.genesisTurns, docked: false });
    const c = PLANET_CLASSES[cls];
    report.push(`The Genesis torpedo detonated. A Class ${cls} (${c.name}) world, ${pl!.name}, now orbits in sector ${p.sector}. It's yours.`);
    mail.to(p.id, "planet", report[0]!);
  });
  events.emit(gameId, { kind: "deploy", sector: me.sector, alias: me.alias, message: `${me.alias} created a planet.` });
  return { state: await getState(gameId, userId), report };
}

export async function land(gameId: number, userId: number, planetId: number) {
  const { settings: s } = await loadGame(gameId);
  const me = await requirePlayer(gameId, userId);
  await withMail(gameId, async (tx, mail) => {
    const p = await lockPlayer(tx, me.id);
    const pl = await lockPlanet(tx, planetId);
    if (pl.gameId !== gameId || pl.sectorId !== p.sector) throw new GameError("That planet isn't in this sector");
    if (p.landedPlanetId === pl.id) return;
    const ours = !!pl.ownerId && (await alliesOf(tx, p)).has(pl.ownerId);
    if (pl.ownerId && !ours) {
      if (pl.fighters > 0 || pl.shields > 0) throw new GameError(`${pl.name} is defended. Attack it first.`);
      // Undefended enemy planet: landing takes it.
      mail.to(pl.ownerId, "planet", `${p.alias} landed on your undefended planet ${pl.name} in sector ${pl.sectorId} and took it.`);
    }
    if (p.turns < s.landTurns) throw new GameError("Not enough turns left today");
    if (!ours) {
      // Same as a capture: the old owner's orders are wiped and anyone else landed there is put back in orbit.
      await setPlanet(tx, pl.id, { ownerId: p.id, buildDaysLeft: null, interdictor: false, militaryPct: 0, qSectorPct: 0, qAtmoPct: 0 });
      await tx.update(schema.players).set({ landedPlanetId: null }).where(and(eq(schema.players.landedPlanetId, pl.id), sql`${schema.players.id} <> ${p.id}`));
      mail.to(p.id, "planet", `You claimed ${pl.name} (Class ${pl.cls}) in sector ${pl.sectorId}.`);
    }
    await setPlayer(tx, p.id, { landedPlanetId: pl.id, turns: p.turns - s.landTurns, docked: false, cloaked: false });
  });
  return getState(gameId, userId);
}

export async function liftOff(gameId: number, userId: number) {
  const me = await requirePlayer(gameId, userId);
  await db.update(schema.players).set({ landedPlanetId: null }).where(eq(schema.players.id, me.id));
  return getState(gameId, userId);
}

export async function loadColonists(gameId: number, userId: number, qty: number) {
  const { settings: s } = await loadGame(gameId);
  const me = await requirePlayer(gameId, userId);
  if (me.sector !== 1) throw new GameError(`Colonists board at ${PLACE.homeWorld} in sector 1`);
  await db.transaction(async (tx) => {
    const p = await lockPlayer(tx, me.id);
    const [g] = await tx.select().from(schema.games).where(eq(schema.games.id, gameId)).for("update");
    const pool = g!.colonistPool ?? s.colonistsStart;
    const n = Math.floor(qty);
    const max = Math.min(pool, freeHolds(p));
    if (!(n > 0) || n > max) throw new GameError(max ? `You can take 1-${max} colonists` : "No free holds, or no colonists waiting");
    await tx.update(schema.games).set({ colonistPool: pool - n }).where(eq(schema.games.id, gameId));
    await setPlayer(tx, p.id, { cargoColonists: p.cargoColonists + n });
  });
  return getState(gameId, userId);
}

type Movable = "colonists" | "ore" | "org" | "equ" | "fighters";

/**
 * Move things between your ship and the planet you're on. Positive = ship to planet.
 * Colonists land in the production group you pick.
 */
export async function transfer(gameId: number, userId: number, what: Movable, amount: number, group: "ore" | "org" | "equ" = "ore") {
  const me = await requirePlayer(gameId, userId);
  if (!["colonists", "ore", "org", "equ", "fighters"].includes(what)) throw new GameError("Unknown cargo");
  if (!["ore", "org", "equ"].includes(group)) throw new GameError("Pick Fuel Ore, Organics or Equipment for the colonists");
  const n = Math.trunc(amount);
  if (!n || !Number.isSafeInteger(n)) throw new GameError("Enter an amount");
  await db.transaction(async (tx) => {
    const p = await lockPlayer(tx, me.id);
    const pl = await myLandedPlanet(tx, p);
    const ship = SHIP_TYPES[p.ship]!;
    if (what === "fighters") {
      if (n > 0 && n > p.fighters) throw new GameError(`You have ${p.fighters} fighters`);
      if (n < 0 && -n > pl.fighters) throw new GameError(`The planet has ${pl.fighters} fighters`);
      if (n < 0 && p.fighters - n > ship.maxFighters) throw new GameError(`Your ship holds at most ${ship.maxFighters} fighters`);
      await setPlayer(tx, p.id, { fighters: p.fighters - n });
      await setPlanet(tx, pl.id, { fighters: pl.fighters + n });
      return;
    }
    if (what === "colonists") {
      const col = ({ ore: "colOre", org: "colOrg", equ: "colEqu" } as const)[group];
      if (!col) throw new GameError("Pick Fuel Ore, Organics or Equipment for the colonists");
      if (n > 0) {
        if (n > p.cargoColonists) throw new GameError(`You have ${p.cargoColonists} colonists aboard`);
        const room = PLANET_CLASSES[pl.cls].maxColonists - (pl.colOre + pl.colOrg + pl.colEqu);
        if (n > room) throw new GameError(`${pl.name} has room for ${Math.max(0, room)} more colonists`);
      } else {
        if (-n > pl[col]) throw new GameError(`Only ${pl[col]} colonists work that job`);
        if (-n > freeHolds(p)) throw new GameError(`You have ${freeHolds(p)} free holds`);
      }
      await setPlayer(tx, p.id, { cargoColonists: p.cargoColonists - n });
      await setPlanet(tx, pl.id, { [col]: pl[col] + n });
      return;
    }
    const cargo = ({ ore: "cargoOre", org: "cargoOrg", equ: "cargoEqu" } as const)[what];
    if (n > 0 && n > p[cargo]) throw new GameError(`You have ${p[cargo]} aboard`);
    if (n < 0 && -n > pl[what]) throw new GameError(`The planet has ${pl[what]}`);
    if (n < 0 && -n > freeHolds(p)) throw new GameError(`You have ${freeHolds(p)} free holds`);
    await setPlayer(tx, p.id, { [cargo]: p[cargo] - n });
    await setPlanet(tx, pl.id, { [what]: pl[what] + n });
  });
  return getState(gameId, userId);
}

/** Re-assign colonists between production jobs (total stays the same). */
export async function assignColonists(gameId: number, userId: number, split: { ore: number; org: number; equ: number }) {
  const me = await requirePlayer(gameId, userId);
  await db.transaction(async (tx) => {
    const p = await lockPlayer(tx, me.id);
    const pl = await myLandedPlanet(tx, p);
    const v = { ore: Math.floor(split.ore), org: Math.floor(split.org), equ: Math.floor(split.equ) };
    if (Object.values(v).some((x) => !(x >= 0))) throw new GameError("Colonist counts can't be negative");
    if (v.ore + v.org + v.equ !== pl.colOre + pl.colOrg + pl.colEqu) throw new GameError("The totals must match the colonists on the planet");
    await setPlanet(tx, pl.id, { colOre: v.ore, colOrg: v.org, colEqu: v.equ });
  });
  return getPlanet(gameId, userId);
}

export async function treasury(gameId: number, userId: number, amount: number) {
  const me = await requirePlayer(gameId, userId);
  const n = Math.trunc(amount);
  if (!n) throw new GameError("Enter an amount");
  await db.transaction(async (tx) => {
    const p = await lockPlayer(tx, me.id);
    const pl = await myLandedPlanet(tx, p);
    if (pl.citadel < 1) throw new GameError("Build a citadel (level 1: Planetary Treasury) first");
    if (n > 0 && n > p.credits) throw new GameError(`You have ${p.credits.toLocaleString()} credits`);
    if (n < 0 && -n > pl.credits) throw new GameError(`The treasury holds ${pl.credits.toLocaleString()} credits`);
    await setPlayer(tx, p.id, { credits: p.credits - n });
    await setPlanet(tx, pl.id, { credits: pl.credits + n });
  });
  return getState(gameId, userId);
}

export async function buildCitadel(gameId: number, userId: number) {
  const me = await requirePlayer(gameId, userId);
  await withMail(gameId, async (tx, mail) => {
    const p = await lockPlayer(tx, me.id);
    const pl = await myLandedPlanet(tx, p);
    if (pl.buildDaysLeft != null) throw new GameError("Construction is already under way");
    if (pl.citadel >= 6) throw new GameError("The citadel is complete");
    const level = pl.citadel + 1;
    const c = citadelCost(pl.cls, level);
    const col = pl.colOre + pl.colOrg + pl.colEqu;
    const short: string[] = [];
    if (col < c.colonists) short.push(`${(c.colonists - col).toLocaleString()} more colonists`);
    if (pl.ore < c.ore) short.push(`${c.ore - pl.ore} more Fuel Ore`);
    if (pl.org < c.org) short.push(`${c.org - pl.org} more Organics`);
    if (pl.equ < c.equ) short.push(`${c.equ - pl.equ} more Equipment`);
    if (short.length) throw new GameError(`Level ${level} needs ${short.join(", ")} on the planet`);
    await setPlanet(tx, pl.id, { ore: pl.ore - c.ore, org: pl.org - c.org, equ: pl.equ - c.equ, buildDaysLeft: c.days });
    mail.to(p.id, "planet", `Construction of ${CITADEL_LEVELS[level - 1]!.name} (level ${level}) began on ${pl.name}. Done in ${c.days} day${c.days > 1 ? "s" : ""}.`);
  });
  return getPlanet(gameId, userId);
}

export async function planetSettings(gameId: number, userId: number, v: { militaryPct?: number; qSectorPct?: number; qAtmoPct?: number; interdictor?: boolean }) {
  const me = await requirePlayer(gameId, userId);
  await db.transaction(async (tx) => {
    const p = await lockPlayer(tx, me.id);
    const pl = await myLandedPlanet(tx, p);
    const pct = (x: number | undefined, need: number, label: string) => {
      if (x == null) return undefined;
      if (pl.citadel < need) throw new GameError(`${label} needs citadel level ${need}`);
      const n = Math.floor(x);
      if (!(n >= 0 && n <= 100)) throw new GameError("Percentages are 0-100");
      return n;
    };
    const patch: Partial<PlanetRow> = {};
    const m = pct(v.militaryPct, 2, "Military reaction"); if (m != null) patch.militaryPct = m;
    const qs = pct(v.qSectorPct, 3, "The Quasar Cannon"); if (qs != null) patch.qSectorPct = qs;
    const qa = pct(v.qAtmoPct, 3, "The Quasar Cannon"); if (qa != null) patch.qAtmoPct = qa;
    if (v.interdictor != null) {
      if (pl.citadel < 6) throw new GameError("The Interdictor Generator needs citadel level 6");
      const on: unknown = v.interdictor;
      if (on !== true && on !== false) throw new GameError("Turn the interdictor on or off");
      patch.interdictor = on;
    }
    await setPlanet(tx, pl.id, patch);
  });
  return getPlanet(gameId, userId);
}

/** Level 5: convert ship shields into planetary shields. */
export async function chargeShields(gameId: number, userId: number, shipShields: number) {
  const { settings: s } = await loadGame(gameId);
  const me = await requirePlayer(gameId, userId);
  await db.transaction(async (tx) => {
    const p = await lockPlayer(tx, me.id);
    const pl = await myLandedPlanet(tx, p);
    if (pl.citadel < 5) throw new GameError("Planetary shields need citadel level 5");
    const n = Math.floor(shipShields / s.planetShieldConversion) * s.planetShieldConversion;
    if (!(n > 0) || n > p.shields) throw new GameError(`Transfer shields in multiples of ${s.planetShieldConversion} (you have ${p.shields})`);
    await setPlayer(tx, p.id, { shields: p.shields - n });
    await setPlanet(tx, pl.id, { shields: pl.shields + n / s.planetShieldConversion });
  });
  return getState(gameId, userId);
}

/** Level 4: move the planet (and you, landed on it) to another sector. */
export async function planetWarp(gameId: number, userId: number, to: number): Promise<ActionResultDto> {
  const { settings: s } = await loadGame(gameId);
  if (!Number.isSafeInteger(to) || to < 1) throw new GameError("Pick a sector to jump to");
  const me = await requirePlayer(gameId, userId);
  if (await isFedspace(db, gameId, to)) throw new GameError(`Planets can't be moved into ${PLACE.core}`);
  const path = plotCourse(await adjacency(gameId), me.sector, to, s.maxCourseLength);
  if (!path?.length) throw new GameError(`No route to sector ${to}`);
  const report: string[] = [];
  const from = me.sector;
  await withMail(gameId, async (tx, mail) => {
    const p = await lockPlayer(tx, me.id);
    const pl = await myLandedPlanet(tx, p);
    if (pl.citadel < 4) throw new GameError("Planetary TransWarp needs citadel level 4");
    const ore = path.length * s.planetWarpOrePerSector;
    if (pl.ore < ore) throw new GameError(`That jump burns ${ore.toLocaleString()} Fuel Ore; ${pl.name} has ${pl.ore.toLocaleString()}`);
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.planets)
      .where(and(eq(schema.planets.gameId, gameId), eq(schema.planets.sectorId, to)));
    if (n >= s.maxPlanetsPerSector) throw new GameError(`Sector ${to} already has the most planets it can hold`);
    await setPlanet(tx, pl.id, { sectorId: to, ore: pl.ore - ore });
    // Only the pilot rides along; anyone else landed there is left in orbit where the planet was.
    const left = await tx.update(schema.players).set({ landedPlanetId: null })
      .where(and(eq(schema.players.landedPlanetId, pl.id), sql`${schema.players.id} <> ${p.id}`)).returning({ id: schema.players.id });
    for (const o of left) mail.to(o.id, "planet", `${pl.name} jumped to another sector without you; you're in orbit in sector ${from}.`);
    await setPlayer(tx, p.id, { sector: to, prevSector: from, docked: false, tollPaidSector: null });
    await tx.insert(schema.visited).values({ playerId: p.id, sectorId: to }).onConflictDoNothing();
    report.push(`${pl.name} jumped ${path.length} sector${path.length > 1 ? "s" : ""} to sector ${to}, burning ${ore.toLocaleString()} Fuel Ore.`);
    mail.to(p.id, "planet", report[0]!);
  });
  events.emit(gameId, { kind: "depart", sector: from, alias: me.alias, message: "A planet vanished from the sector." });
  events.emit(gameId, { kind: "arrive", sector: to, alias: me.alias, message: "A planet warped into the sector." });
  return { state: await getState(gameId, userId), report };
}

/** Attack a planet from orbit. The atmospheric Q-cannon fires first; clearing all defenses captures it. */
export async function attackPlanet(gameId: number, userId: number, planetId: number, fighters: number): Promise<ActionResultDto> {
  if (!Number.isInteger(planetId)) throw new GameError("Pick a planet to attack");
  const { settings: s } = await loadGame(gameId);
  const me = await requirePlayer(gameId, userId);
  const report: string[] = [];
  await withMail(gameId, async (tx, mail) => {
    let p = await lockPlayer(tx, me.id);
    const pl = await lockPlanet(tx, planetId);
    if (pl.gameId !== gameId || pl.sectorId !== p.sector) throw new GameError("That planet isn't in this sector");
    if (pl.ownerId === p.id) throw new GameError("That's your planet");
    if (pl.ownerId && (await alliesOf(tx, p)).has(pl.ownerId)) throw new GameError("That planet belongs to your corporation");
    if (p.turns < s.attackTurns) throw new GameError("Not enough turns left today");
    let n = Math.floor(fighters);
    if (!(n > 0) || n > p.fighters) throw new GameError(`Send between 1 and ${p.fighters} fighters`);
    const [owner] = pl.ownerId ? await tx.select().from(schema.players).where(eq(schema.players.id, pl.ownerId)) : [];
    let ore = pl.ore;
    // A photon wave knocks out a weakly shielded planet's cannon, as it does its other defenses.
    const knockedOut = (await photonActive(tx, gameId, p.sector)) && pl.shields < s.photonPlanetShieldLimit;
    if (knockedOut) report.push(`${pl.name}'s defenses are down from the photon wave.`);
    if (!knockedOut && pl.citadel >= 3 && pl.qAtmoPct > 0 && ore > 0) {
      const shot = qCannonShot(ore, pl.qAtmoPct, "atmo", s.qAtmoMultiplier);
      ore -= shot.burned;
      const dmg = applyDamage(shot.damage, p.fighters, p.shields);
      report.push(`${pl.name}'s atmospheric Quasar Cannon hit you: -${dmg.shieldsLost} shields, -${dmg.fightersLost} fighters.`);
      if (dmg.destroyed) {
        await setPlanet(tx, pl.id, { ore });
        await destroyShip(tx, s, gameId, p, owner ?? null, mail, `${pl.name}'s Quasar Cannon shot you down in sector ${p.sector}.`);
        report.push("Your ship was destroyed.");
        if (pl.ownerId) mail.to(pl.ownerId, "combat", `${pl.name}'s Quasar Cannon destroyed ${p.alias}'s ship as they attacked.`);
        return;
      }
      p = { ...p, fighters: p.fighters - dmg.fightersLost, shields: p.shields - dmg.shieldsLost };
      n = Math.min(n, p.fighters);
    }
    const defOdds = pl.citadel >= 2 ? s.planetDefensiveOdds : s.planetBaseOdds;
    const r = resolvePlanetAssault({ attFighters: n, attOdds: SHIP_TYPES[p.ship]!.offensiveOdds, shields: pl.shields, shieldOdds: s.planetShieldOdds, defFighters: pl.fighters, defOdds });
    await setPlayer(tx, p.id, { fighters: p.fighters - r.attLost, shields: p.shields, turns: p.turns - s.attackTurns, docked: false, cloaked: false });
    const patch: Partial<PlanetRow> = { ore, shields: pl.shields - r.shieldsLost, fighters: pl.fighters - r.fightersLost };
    if (r.captured) {
      Object.assign(patch, { ownerId: p.id, buildDaysLeft: null, interdictor: false, militaryPct: 0, qSectorPct: 0, qAtmoPct: 0 });
      await setPlayer(tx, p.id, { landedPlanetId: pl.id });
      report.push(`You broke ${pl.name}'s defenses (lost ${r.attLost} fighters) and landed. The planet is yours, treasury and all.`);
      if (pl.ownerId) mail.to(pl.ownerId, "combat", `${p.alias} captured your planet ${pl.name} in sector ${p.sector}.`);
      // Anyone else landed there is bumped back into orbit.
      await tx.update(schema.players).set({ landedPlanetId: null }).where(and(eq(schema.players.landedPlanetId, pl.id), sql`${schema.players.id} <> ${p.id}`));
    } else {
      report.push(`You lost ${r.attLost} fighters. ${pl.name} lost ${r.shieldsLost} shields and ${r.fightersLost} fighters.`);
      if (pl.ownerId) mail.to(pl.ownerId, "combat", `${p.alias} attacked ${pl.name} in sector ${p.sector}: it lost ${r.shieldsLost} shields and ${r.fightersLost} fighters; they lost ${r.attLost}.`);
    }
    await setPlanet(tx, pl.id, patch);
  });
  events.emit(gameId, { kind: "combat", sector: me.sector, alias: me.alias, message: `${me.alias} is attacking a planet!` });
  return { state: await getState(gameId, userId), report };
}

export const planetClassFor = (id: string) => PLANET_CLASSES[id as PlanetClassId];
