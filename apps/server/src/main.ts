import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { PgBoss } from "pg-boss";
import { config } from "./config";
import { pool, runMigrations } from "./db";
import { authRoutes, installUserHook } from "./auth";
import { gameRoutes } from "./routes";
import { allGameIds, dailyReset, events } from "./game";
import { npcTick } from "./npc";
import { startRealtime, useNotifyEvents } from "./realtime";

// dist/main.js and src/main.ts both sit one level below the server package root.
const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(here, "../drizzle");

async function runApp() {
  await runMigrations(MIGRATIONS);
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, trustProxy: true });
  await app.register(cookie);
  installUserHook(app);
  await app.register(authRoutes);
  await app.register(gameRoutes);
  app.get("/healthz", async () => {
    await pool.query("select 1");
    return { ok: true };
  });

  const webDir = config.webDir || path.resolve(here, "../../web/dist");
  if (existsSync(webDir)) {
    await app.register(fastifyStatic, { root: webDir, wildcard: false });
    // Single-page app: unknown non-API paths get index.html.
    app.setNotFoundHandler((req, reply) => {
      const pathOnly = req.url.split("?")[0]!;
      if (pathOnly.startsWith("/api/") || pathOnly.startsWith("/socket.io") || /\.[a-z0-9]+$/i.test(pathOnly)) {
        return reply.code(404).send({ error: "Not found" });
      }
      return reply.sendFile("index.html");
    });
  } else {
    app.log.warn({ webDir }, "web build not found; serving API only");
  }

  await app.ready();
  await startRealtime(app.server);
  await app.listen({ port: config.port, host: config.host });
  const stop = async () => { await app.close(); await pool.end(); process.exit(0); };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

async function runWorker() {
  await runMigrations(MIGRATIONS);
  useNotifyEvents();
  const boss = new PgBoss(config.databaseUrl);
  boss.on("error", (err) => console.error("pg-boss error", err));
  await boss.start();
  await boss.createQueue("daily-reset");
  // missed: "once" means a worker that was down at midnight still runs one reset when it comes back.
  await boss.schedule("daily-reset", config.resetCron, null, { tz: config.resetTz, missed: "once" });
  await boss.work("daily-reset", async () => {
    for (const id of await allGameIds()) {
      await dailyReset(id);
      events.emit(id, { kind: "reset", sector: 0, alias: "", message: "A new day: turns restored and ports restocked." });
      console.log(`daily reset done for game ${id}`);
    }
  });
  // NPCs act once a minute. "exclusive" keeps ticks from piling up if one runs long; a failed tick isn't retried.
  await boss.createQueue("npc-tick", { policy: "exclusive", retryLimit: 0 });
  await boss.schedule("npc-tick", "* * * * *");
  await boss.work("npc-tick", async () => {
    for (const id of await allGameIds()) await npcTick(id);
  });
  console.log(`worker running; daily reset "${config.resetCron}" (${config.resetTz})`);
  const stop = async () => { await boss.stop(); await pool.end(); process.exit(0); };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

const mode = process.argv[2] ?? "app";
(mode === "worker" ? runWorker() : runApp()).catch((err) => {
  console.error(err);
  process.exit(1);
});
