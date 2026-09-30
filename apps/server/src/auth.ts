import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, eq, gt, sql } from "drizzle-orm";
import type { MeDto } from "@st/shared";
import { db, schema } from "./db";
import { config } from "./config";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
export const SESSION_COOKIE = "st_session";
const SESSION_DAYS = 30;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [algo, saltHex, hashHex] = stored.split("$");
  if (algo !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(pw, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(expected, actual);
}

export async function userForToken(token: string | undefined): Promise<MeDto | null> {
  if (!token) return null;
  const rows = await db
    .select({ id: schema.users.id, username: schema.users.username, isAdmin: schema.users.isAdmin })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.token, token), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0] ?? null;
}

declare module "fastify" {
  interface FastifyRequest { user: MeDto | null }
}

/** Route guard: 401 unless logged in. */
export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  if (!req.user) return reply.code(401).send({ error: "Not logged in" });
}

const USERNAME_RE = /^[A-Za-z0-9_-]{3,24}$/;

/** Must be called on the root instance so every route sees req.user. */
export function installUserHook(app: FastifyInstance) {
  app.decorateRequest("user", null);
  app.addHook("preHandler", async (req) => {
    req.user = await userForToken(req.cookies[SESSION_COOKIE]);
  });
}

export async function authRoutes(app: FastifyInstance) {

  const setSession = async (reply: FastifyReply, userId: number) => {
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
    await db.insert(schema.sessions).values({ token, userId, expiresAt });
    reply.setCookie(SESSION_COOKIE, token, {
      path: "/", httpOnly: true, sameSite: "lax", secure: config.secureCookies, expires: expiresAt,
    });
  };

  app.post<{ Body: { username?: string; password?: string } }>("/api/auth/register", async (req, reply) => {
    const username = String(req.body?.username ?? "").trim();
    const password = String(req.body?.password ?? "");
    if (!USERNAME_RE.test(username)) return reply.code(400).send({ error: "Username must be 3-24 letters, numbers, _ or -" });
    if (password.length < 8) return reply.code(400).send({ error: "Password must be at least 8 characters" });
    const exists = await db.select({ id: schema.users.id }).from(schema.users)
      .where(sql`lower(${schema.users.username}) = lower(${username})`).limit(1);
    if (exists.length) return reply.code(409).send({ error: "That username is taken" });
    // The first account on a fresh install becomes the admin.
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.users);
    const [user] = await db.insert(schema.users)
      .values({ username, passwordHash: await hashPassword(password), isAdmin: count === 0 })
      .returning();
    await setSession(reply, user!.id);
    return { id: user!.id, username: user!.username, isAdmin: user!.isAdmin } satisfies MeDto;
  });

  app.post<{ Body: { username?: string; password?: string } }>("/api/auth/login", async (req, reply) => {
    const username = String(req.body?.username ?? "").trim();
    const [user] = await db.select().from(schema.users)
      .where(sql`lower(${schema.users.username}) = lower(${username})`).limit(1);
    if (!user || !(await verifyPassword(String(req.body?.password ?? ""), user.passwordHash))) {
      return reply.code(401).send({ error: "Wrong username or password" });
    }
    await setSession(reply, user.id);
    return { id: user.id, username: user.username, isAdmin: user.isAdmin } satisfies MeDto;
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await db.delete(schema.sessions).where(eq(schema.sessions.token, token));
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/me", async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "Not logged in" });
    return req.user;
  });
}
