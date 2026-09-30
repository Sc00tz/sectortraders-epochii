import type { FastifyInstance, FastifyReply } from "fastify";
import { eq, sql } from "drizzle-orm";
import type { Commodity, GameSummaryDto } from "@st/shared";
import { db, schema } from "./db";
import { requireUser } from "./auth";
import * as game from "./game";
import * as actions from "./actions";
import { listMessages, markRead } from "./messages";
import * as planets from "./planets";
import * as corps from "./corps";
import * as gear from "./gear";
import * as office from "./office";
import * as comms from "./comms";
import * as bookmarks from "./bookmarks";

/** Postgres codes for input that can't be a valid value (bad number text, out of range). */
const BAD_INPUT = new Set(["22P02", "22003", "22023"]);

function fail(reply: FastifyReply, err: unknown) {
  if (err instanceof game.GameError) return reply.code(err.status).send({ error: err.message });
  throw err;
}

/** Anything that isn't a GameError: never send SQL or stack details to the browser. */
function hideInternals(app: FastifyInstance) {
  app.setErrorHandler((err: Error & { statusCode?: number; cause?: { code?: string }; code?: string }, req, reply) => {
    if (err instanceof game.GameError) return reply.code(err.status).send({ error: err.message });
    const code = err.cause?.code ?? err.code;
    if (code && BAD_INPUT.has(code)) return reply.code(400).send({ error: "That request didn't make sense" });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
    req.log.error(err);
    return reply.code(500).send({ error: "Something went wrong on the server" });
  });
}

export async function gameRoutes(app: FastifyInstance) {
  hideInternals(app);
  app.addHook("preHandler", async (req, reply) => {
    if (req.url.startsWith("/api/games") || req.url.startsWith("/api/admin")) return requireUser(req, reply);
  });

  app.get("/api/games", async (req) => {
    const rows = await db.select({
      id: schema.games.id, name: schema.games.name, settings: schema.games.settings,
      // Spelled out: drizzle renders ${schema.games.id} unqualified here, which would bind to p.id.
      players: sql<number>`(select count(*)::int from players p where p.game_id = "games"."id" and p.npc is null)`,
    }).from(schema.games).orderBy(schema.games.id);
    const mine = await db.select({ gameId: schema.players.gameId, alias: schema.players.alias })
      .from(schema.players).where(eq(schema.players.userId, req.user!.id));
    const aliasBy = new Map(mine.map((m) => [m.gameId, m.alias]));
    return rows.map((g): GameSummaryDto => ({
      id: g.id, name: g.name, sectors: g.settings.sectors, players: g.players,
      joined: aliasBy.has(g.id), alias: aliasBy.get(g.id) ?? null,
    }));
  });

  type P = { Params: { id: string } };
  const gid = (p: { id: string }) => {
    const n = Number(p.id);
    if (!Number.isSafeInteger(n) || n < 1 || n > 2_147_483_647) throw new game.GameError("No such galaxy", 404);
    return n;
  };

  app.post<P & { Body: { alias?: string } }>("/api/games/:id/join", async (req, reply) => {
    try {
      await game.joinGame(gid(req.params), req.user!.id, String(req.body?.alias ?? ""));
      return await game.getState(gid(req.params), req.user!.id);
    } catch (e) { return fail(reply, e); }
  });

  app.post<P & { Body: { confirm?: string } }>("/api/games/:id/leave", async (req, reply) => {
    try { return await game.leaveGame(gid(req.params), req.user!.id, String(req.body?.confirm ?? "")); } catch (e) { return fail(reply, e); }
  });

  app.get<P>("/api/games/:id/state", async (req, reply) => {
    try { return await game.getState(gid(req.params), req.user!.id); } catch (e) { return fail(reply, e); }
  });

  app.get<P>("/api/games/:id/map", async (req, reply) => {
    try { return await game.getMap(gid(req.params), req.user!.id); } catch (e) { return fail(reply, e); }
  });

  app.post<P & { Body: { to?: number } }>("/api/games/:id/move", async (req, reply) => {
    try { return await game.move(gid(req.params), req.user!.id, Number(req.body?.to)); } catch (e) { return fail(reply, e); }
  });

  app.get<P & { Querystring: { to?: string } }>("/api/games/:id/course", async (req, reply) => {
    try { return await game.course(gid(req.params), req.user!.id, Number(req.query.to)); } catch (e) { return fail(reply, e); }
  });

  app.post<P & { Body: { to?: number } }>("/api/games/:id/autopilot", async (req, reply) => {
    try { return await game.autopilot(gid(req.params), req.user!.id, Number(req.body?.to)); } catch (e) { return fail(reply, e); }
  });

  app.post<P>("/api/games/:id/port/dock", async (req, reply) => {
    try { return await game.dock(gid(req.params), req.user!.id); } catch (e) { return fail(reply, e); }
  });

  app.post<P & { Body: { commodity?: string; qty?: number } }>("/api/games/:id/port/quote", async (req, reply) => {
    try {
      return await game.quote(gid(req.params), req.user!.id, String(req.body?.commodity) as Commodity, Number(req.body?.qty));
    } catch (e) { return fail(reply, e); }
  });

  app.post<P & { Body: { offer?: number } }>("/api/games/:id/port/offer", async (req, reply) => {
    try { return await game.offer(gid(req.params), req.user!.id, Number(req.body?.offer)); } catch (e) { return fail(reply, e); }
  });

  // ----- shops and shipyard -----
  app.get<P>("/api/games/:id/shop", async (req, reply) => {
    try { return await actions.shopInfo(gid(req.params), req.user!.id); } catch (e) { return fail(reply, e); }
  });
  app.post<P & { Body: { item?: string; qty?: number } }>("/api/games/:id/shop/buy", async (req, reply) => {
    try { return await actions.buyHardware(gid(req.params), req.user!.id, String(req.body?.item) as actions.HardwareItem, Number(req.body?.qty)); } catch (e) { return fail(reply, e); }
  });
  app.get<P>("/api/games/:id/shipyard", async (req, reply) => {
    try { return await actions.shipyard(gid(req.params), req.user!.id); } catch (e) { return fail(reply, e); }
  });
  app.post<P & { Body: { ship?: string } }>("/api/games/:id/shipyard/buy", async (req, reply) => {
    try { return await actions.buyShip(gid(req.params), req.user!.id, String(req.body?.ship)); } catch (e) { return fail(reply, e); }
  });
  app.get<P>("/api/games/:id/relief", async (req, reply) => {
    try { return await actions.reliefOffer(gid(req.params), req.user!.id); } catch (e) { return fail(reply, e); }
  });
  app.post<P>("/api/games/:id/relief/claim", async (req, reply) => {
    try { return await actions.claimRelief(gid(req.params), req.user!.id); } catch (e) { return fail(reply, e); }
  });
  app.post<P>("/api/games/:id/stardock/remove-limpets", async (req, reply) => {
    try { return await actions.removeLimpets(gid(req.params), req.user!.id); } catch (e) { return fail(reply, e); }
  });
  app.get<P>("/api/games/:id/limpets", async (req, reply) => {
    try { return await actions.limpetTracks(gid(req.params), req.user!.id); } catch (e) { return fail(reply, e); }
  });

  // ----- combat and deployables -----
  app.post<P & { Body: { target?: number; fighters?: number } }>("/api/games/:id/attack", async (req, reply) => {
    try { return await actions.attackPlayer(gid(req.params), req.user!.id, Number(req.body?.target), Number(req.body?.fighters)); } catch (e) { return fail(reply, e); }
  });
  app.post<P & { Body: { fighters?: number } }>("/api/games/:id/attack-fighters", async (req, reply) => {
    try { return await actions.attackFighters(gid(req.params), req.user!.id, Number(req.body?.fighters)); } catch (e) { return fail(reply, e); }
  });
  app.post<P & { Body: { count?: number; mode?: string } }>("/api/games/:id/fighters/deploy", async (req, reply) => {
    try { return await actions.deployFighters(gid(req.params), req.user!.id, Number(req.body?.count), String(req.body?.mode) as never); } catch (e) { return fail(reply, e); }
  });
  app.post<P & { Body: { count?: number } }>("/api/games/:id/fighters/retrieve", async (req, reply) => {
    try { return await actions.retrieveFighters(gid(req.params), req.user!.id, Number(req.body?.count)); } catch (e) { return fail(reply, e); }
  });
  app.post<P & { Body: { kind?: string; count?: number } }>("/api/games/:id/mines/lay", async (req, reply) => {
    try { return await actions.layMines(gid(req.params), req.user!.id, String(req.body?.kind) as never, Number(req.body?.count)); } catch (e) { return fail(reply, e); }
  });
  app.post<P>("/api/games/:id/toll/pay", async (req, reply) => {
    try { return await actions.payToll(gid(req.params), req.user!.id); } catch (e) { return fail(reply, e); }
  });

  // ----- planets -----
  app.post<P & { Body: { name?: string } }>("/api/games/:id/planet/genesis", async (req, reply) => {
    try { return await planets.launchGenesis(gid(req.params), req.user!.id, String(req.body?.name ?? "")); } catch (e) { return fail(reply, e); }
  });
  app.post<P & { Body: { planet?: number } }>("/api/games/:id/planet/land", async (req, reply) => {
    try { return await planets.land(gid(req.params), req.user!.id, Number(req.body?.planet)); } catch (e) { return fail(reply, e); }
  });
  app.post<P>("/api/games/:id/planet/leave", async (req, reply) => {
    try { return await planets.liftOff(gid(req.params), req.user!.id); } catch (e) { return fail(reply, e); }
  });
  app.get<P>("/api/games/:id/planet", async (req, reply) => {
    try { return await planets.getPlanet(gid(req.params), req.user!.id); } catch (e) { return fail(reply, e); }
  });
  app.post<P & { Body: { what?: string; amount?: number; group?: string } }>("/api/games/:id/planet/transfer", async (req, reply) => {
    try { return await planets.transfer(gid(req.params), req.user!.id, String(req.body?.what) as never, Number(req.body?.amount), (req.body?.group ?? "ore") as never); } catch (e) { return fail(reply, e); }
  });
  app.post<P & { Body: { ore?: number; org?: number; equ?: number } }>("/api/games/:id/planet/assign", async (req, reply) => {
    try { return await planets.assignColonists(gid(req.params), req.user!.id, { ore: Number(req.body?.ore), org: Number(req.body?.org), equ: Number(req.body?.equ) }); } catch (e) { return fail(reply, e); }
  });
  app.post<P & { Body: { amount?: number } }>("/api/games/:id/planet/treasury", async (req, reply) => {
    try { return await planets.treasury(gid(req.params), req.user!.id, Number(req.body?.amount)); } catch (e) { return fail(reply, e); }
  });
  app.post<P>("/api/games/:id/planet/citadel", async (req, reply) => {
    try { return await planets.buildCitadel(gid(req.params), req.user!.id); } catch (e) { return fail(reply, e); }
  });
  app.post<P & { Body: { militaryPct?: number; qSectorPct?: number; qAtmoPct?: number; interdictor?: boolean } }>("/api/games/:id/planet/settings", async (req, reply) => {
    try { return await planets.planetSettings(gid(req.params), req.user!.id, req.body ?? {}); } catch (e) { return fail(reply, e); }
  });
  app.post<P & { Body: { shields?: number } }>("/api/games/:id/planet/shields", async (req, reply) => {
    try { return await planets.chargeShields(gid(req.params), req.user!.id, Number(req.body?.shields)); } catch (e) { return fail(reply, e); }
  });
  app.post<P & { Body: { to?: number } }>("/api/games/:id/planet/warp", async (req, reply) => {
    try { return await planets.planetWarp(gid(req.params), req.user!.id, Number(req.body?.to)); } catch (e) { return fail(reply, e); }
  });
  app.post<P & { Body: { planet?: number; fighters?: number } }>("/api/games/:id/planet/attack", async (req, reply) => {
    try { return await planets.attackPlanet(gid(req.params), req.user!.id, Number(req.body?.planet), Number(req.body?.fighters)); } catch (e) { return fail(reply, e); }
  });
  app.post<P & { Body: { qty?: number } }>("/api/games/:id/colonists/load", async (req, reply) => {
    try { return await planets.loadColonists(gid(req.params), req.user!.id, Number(req.body?.qty)); } catch (e) { return fail(reply, e); }
  });

  // ----- message log -----
  app.get<P>("/api/games/:id/messages", async (req, reply) => {
    try {
      const p = await game.requirePlayer(gid(req.params), req.user!.id);
      return await listMessages(p.id, p.lastReadMessageId);
    } catch (e) { return fail(reply, e); }
  });
  app.post<P>("/api/games/:id/messages/read", async (req, reply) => {
    try {
      const p = await game.requirePlayer(gid(req.params), req.user!.id);
      await markRead(p.id);
      return { ok: true };
    } catch (e) { return fail(reply, e); }
  });

  // ----- sector bookmarks -----
  app.get<P>("/api/games/:id/bookmarks", async (req, reply) => {
    try { return { bookmarks: await bookmarks.listBookmarks(gid(req.params), req.user!.id) }; } catch (e) { return fail(reply, e); }
  });
  app.post<P & { Body: { sector?: number; label?: string } }>("/api/games/:id/bookmarks/set", async (req, reply) => {
    try {
      return { bookmarks: await bookmarks.setBookmark(gid(req.params), req.user!.id, Number(req.body?.sector), String(req.body?.label ?? "")) };
    } catch (e) { return fail(reply, e); }
  });
  app.post<P & { Body: { sector?: number } }>("/api/games/:id/bookmarks/remove", async (req, reply) => {
    try {
      return { bookmarks: await bookmarks.removeBookmark(gid(req.params), req.user!.id, Number(req.body?.sector)) };
    } catch (e) { return fail(reply, e); }
  });

  // ----- equipment, crime -----
  type GearBody = { alias?: string; text?: string; to?: number; sector?: number; planet?: number; message?: string; commodity?: string; qty?: number; amount?: number };
  const gearPost = (path: string, fn: (g: number, u: number, b: GearBody) => Promise<unknown>) =>
    app.post<P & { Body: GearBody }>(`/api/games/:id${path}`, async (req, reply) => {
      try { return await fn(gid(req.params), req.user!.id, req.body ?? {}); } catch (e) { return fail(reply, e); }
    });
  gearPost("/transwarp", (g, u, b) => game.transwarp(g, u, Number(b.to)));
  gearPost("/scan/density", (g, u) => gear.densityScan(g, u));
  gearPost("/scan/holo", (g, u) => gear.holoScan(g, u));
  gearPost("/scan/planet", (g, u, b) => planets.scanPlanet(g, u, Number(b.planet)));
  gearPost("/probe", (g, u, b) => gear.launchProbe(g, u, Number(b.to)));
  gearPost("/photon", (g, u, b) => gear.firePhoton(g, u, Number(b.sector)));
  gearPost("/cloak", (g, u) => gear.engageCloak(g, u));
  gearPost("/disruptor", (g, u, b) => gear.fireDisruptor(g, u, Number(b.sector)));
  gearPost("/beacon", (g, u, b) => gear.placeBeacon(g, u, String(b.message ?? "")));
  gearPost("/beacon/remove", (g, u) => gear.removeBeacon(g, u));
  app.get<P>("/api/games/:id/planet/corp-scan", async (req, reply) => {
    try { return await planets.corpPlanetScan(gid(req.params), req.user!.id); } catch (e) { return fail(reply, e); }
  });
  gearPost("/planet/detonate", (g, u) => planets.detonate(g, u));
  gearPost("/port/steal", (g, u, b) => gear.steal(g, u, String(b.commodity) as Commodity, Number(b.qty)));
  gearPost("/comms/direct", (g, u, b) => comms.sendDirect(g, u, String(b.alias ?? ""), String(b.text ?? "")));
  gearPost("/comms/radio", (g, u, b) => comms.radio(g, u, String(b.text ?? "")));
  gearPost("/comms/broadcast", (g, u, b) => comms.broadcast(g, u, String(b.text ?? "")));
  gearPost("/tavern/post", (g, u, b) => comms.postNotice(g, u, String(b.text ?? "")));
  gearPost("/tavern/rumor", (g, u) => comms.buyRumor(g, u));
  gearPost("/tavern/trace", (g, u, b) => comms.traceTrader(g, u, String(b.alias ?? "")));
  app.get<P>("/api/games/:id/tavern", async (req, reply) => {
    try { return await comms.tavernBoard(gid(req.params), req.user!.id); } catch (e) { return fail(reply, e); }
  });
  gearPost("/office/commission", (g, u) => office.requestCommission(g, u));
  gearPost("/office/bounty", (g, u, b) => office.postBounty(g, u, String(b.alias ?? ""), Number(b.amount)));
  gearPost("/port/upgrade", (g, u, b) => office.upgradePort(g, u, String(b.commodity) as Commodity, Number(b.qty)));
  app.get<P>("/api/games/:id/office/bounties", async (req, reply) => {
    try { await game.requirePlayer(gid(req.params), req.user!.id); return await office.mostWanted(gid(req.params)); } catch (e) { return fail(reply, e); }
  });
  gearPost("/port/rob", (g, u, b) => gear.rob(g, u, Number(b.amount)));
  app.get<P>("/api/games/:id/port/crime", async (req, reply) => {
    try { return await gear.crimeLimits(gid(req.params), req.user!.id); } catch (e) { return fail(reply, e); }
  });

  // ----- corporations -----
  type CorpBody = { name?: string; alias?: string; player?: number; corp?: number; amount?: number; text?: string; emblem?: string | null };
  const corpPost = (path: string, fn: (g: number, u: number, b: CorpBody) => Promise<unknown>) =>
    app.post<P & { Body: CorpBody }>(`/api/games/:id/corp${path}`, async (req, reply) => {
      try { return await fn(gid(req.params), req.user!.id, req.body ?? {}); } catch (e) { return fail(reply, e); }
    });
  app.get<P>("/api/games/:id/corp", async (req, reply) => {
    try { return { corp: await corps.getCorp(gid(req.params), req.user!.id) }; } catch (e) { return fail(reply, e); }
  });
  corpPost("/create", (g, u, b) => corps.createCorp(g, u, String(b.name ?? "")));
  corpPost("/invite", (g, u, b) => corps.invite(g, u, String(b.alias ?? "")));
  corpPost("/uninvite", (g, u, b) => corps.cancelInvite(g, u, Number(b.player)));
  corpPost("/accept", (g, u, b) => corps.answerInvite(g, u, Number(b.corp), true));
  corpPost("/decline", (g, u, b) => corps.answerInvite(g, u, Number(b.corp), false));
  corpPost("/leave", (g, u) => corps.leave(g, u));
  corpPost("/expel", (g, u, b) => corps.expel(g, u, Number(b.player)));
  corpPost("/handover", (g, u, b) => corps.handOver(g, u, Number(b.player)));
  corpPost("/disband", (g, u) => corps.disband(g, u));
  corpPost("/deposit", (g, u, b) => corps.deposit(g, u, Number(b.amount)));
  corpPost("/withdraw", (g, u, b) => corps.withdraw(g, u, Number(b.amount)));
  corpPost("/memo", (g, u, b) => corps.setMemo(g, u, String(b.text ?? "")));
  corpPost("/emblem", (g, u, b) => corps.setEmblem(g, u, b.emblem ? String(b.emblem) : null));
  app.get<P>("/api/games/:id/corp/emblems", async (req, reply) => {
    try { await corps.getCorp(gid(req.params), req.user!.id); return { taken: await corps.takenEmblems(gid(req.params)) }; } catch (e) { return fail(reply, e); }
  });
  corpPost("/say", (g, u, b) => corps.say(g, u, String(b.text ?? "")));

  // ----- admin -----
  const requireAdmin = async (req: { user: { isAdmin: boolean } | null }, reply: FastifyReply) => {
    if (!req.user?.isAdmin) return reply.code(403).send({ error: "Admins only" });
  };

  app.post<{ Body: { name?: string; settings?: Record<string, unknown> } }>("/api/admin/games", { preHandler: requireAdmin }, async (req, reply) => {
    const name = String(req.body?.name ?? "").trim();
    if (name.length < 3 || name.length > 60) return reply.code(400).send({ error: "Game name must be 3-60 characters" });
    try {
      const g = await game.createGame(name, game.checkedPatch(req.body?.settings, true));
      return { id: g.id, name: g.name };
    } catch (e) { return fail(reply, e); }
  });

  app.get<P>("/api/admin/games/:id/settings", { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const g = await game.loadGame(gid(req.params));
      return { id: g.id, name: g.name, settings: g.settings };
    } catch (e) { return fail(reply, e); }
  });

  app.post<P & { Body: { settings?: Record<string, unknown> } }>("/api/admin/games/:id/settings", { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const settings = await game.updateSettings(gid(req.params), req.body?.settings);
      req.log.info({ gameId: gid(req.params), by: req.user!.username, changed: Object.keys(req.body?.settings ?? {}) }, "admin changed game settings");
      return { id: gid(req.params), settings };
    } catch (e) { return fail(reply, e); }
  });

  app.post<P>("/api/admin/games/:id/reset", { preHandler: requireAdmin }, async (req, reply) => {
    try {
      await game.dailyReset(gid(req.params));
      game.events.emit(gid(req.params), { kind: "reset", sector: 0, alias: "", message: "A new day: turns restored and ports restocked." });
      return { ok: true };
    } catch (e) { return fail(reply, e); }
  });
}
