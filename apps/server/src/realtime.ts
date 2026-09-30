import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import type { SectorEventDto } from "@st/shared";
import { pool } from "./db";
import { SESSION_COOKIE, userForToken } from "./auth";
import { events, playerFor } from "./game";

const CHANNEL = "st_events";
type Envelope = { gameId: number; e?: SectorEventDto; ping?: number[] };

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Worker side: events go out through Postgres NOTIFY so the app can relay them. */
export function useNotifyEvents() {
  const send = (env: Envelope) => pool.query("SELECT pg_notify($1, $2)", [CHANNEL, JSON.stringify(env)]).catch(() => {});
  events.emit = (gameId, e) => { send({ gameId, e }); };
  events.ping = (gameId, ping) => { send({ gameId, ping }); };
}

/**
 * App side: Socket.IO rooms per game ("g:<id>") and per sector ("g:<id>:s:<n>").
 * Sector events go to the sector room; game-wide events (daily reset) to the game room.
 */
export async function startRealtime(http: HttpServer) {
  const io = new Server(http, { path: "/socket.io", serveClient: false });

  io.use(async (socket, next) => {
    const user = await userForToken(parseCookies(socket.handshake.headers.cookie)[SESSION_COOKIE]).catch(() => null);
    if (!user) return next(new Error("Not logged in"));
    socket.data.userId = user.id;
    next();
  });

  io.on("connection", (socket) => {
    // Client tells us which game it is viewing and re-sends its sector after every move.
    socket.on("watch", async (msg: { gameId: number }) => {
      const gameId = Number(msg?.gameId);
      const p = await playerFor(gameId, socket.data.userId).catch(() => null);
      if (!p) return;
      for (const room of socket.rooms) if (room !== socket.id) socket.leave(room);
      socket.join(`g:${gameId}`);
      socket.join(`g:${gameId}:s:${p.sector}`);
      socket.join(`p:${p.id}`); // personal room: new log messages
    });
  });

  const deliver = ({ gameId, e, ping }: Envelope) => {
    if (e) io.to(e.kind === "reset" ? `g:${gameId}` : `g:${gameId}:s:${e.sector}`).emit("event", e);
    for (const id of ping ?? []) io.to(`p:${id}`).emit("message");
  };
  events.emit = (gameId, e) => deliver({ gameId, e });
  events.ping = (gameId, ping) => deliver({ gameId, ping });

  // Relay events published by the worker.
  const client = await pool.connect();
  await client.query(`LISTEN ${CHANNEL}`);
  client.on("notification", (n) => {
    if (n.channel !== CHANNEL || !n.payload) return;
    try { deliver(JSON.parse(n.payload) as Envelope); } catch { /* ignore malformed */ }
  });
  return io;
}
