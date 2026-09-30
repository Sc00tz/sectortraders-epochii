import {
  type AnyPgColumn, pgTable, serial, integer, text, boolean, timestamp, jsonb, real, bigint, primaryKey, uniqueIndex, index,
} from "drizzle-orm/pg-core";
import type { Commodity, GameSettings, Gear, NpcFaction, NpcRole, PortSlot } from "@st/shared";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull(),
  passwordHash: text("password_hash").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("users_username_idx").on(t.username)]);

export const sessions = pgTable("sessions", {
  token: text("token").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const games = pgTable("games", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  settings: jsonb("settings").$type<GameSettings>().notNull(),
  stardock: integer("stardock").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastResetAt: timestamp("last_reset_at", { withTimezone: true }).notNull().defaultNow(),
  colonistPool: integer("colonist_pool"), // home world colonists; null = not yet initialised
});

export const sectors = pgTable("sectors", {
  gameId: integer("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  id: integer("id").notNull(),
  x: real("x").notNull(),
  y: real("y").notNull(),
  fedspace: boolean("fedspace").notNull().default(false),
  photonUntil: timestamp("photon_until", { withTimezone: true }), // fighters and weak planet defenses here are knocked out until then
}, (t) => [primaryKey({ columns: [t.gameId, t.id] })]);

export const warps = pgTable("warps", {
  gameId: integer("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  fromSector: integer("from_sector").notNull(),
  toSector: integer("to_sector").notNull(),
}, (t) => [primaryKey({ columns: [t.gameId, t.fromSector, t.toSector] })]);

export type PortSlots = Partial<Record<Commodity, PortSlot>>;

export const ports = pgTable("ports", {
  gameId: integer("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  sectorId: integer("sector_id").notNull(),
  name: text("name").notNull(),
  cls: integer("cls").notNull(),
  slots: jsonb("slots").$type<PortSlots>().notNull(),
  heat: integer("heat").notNull().default(0), // thefts and robberies here today; raises the odds of getting caught
}, (t) => [primaryKey({ columns: [t.gameId, t.sectorId] })]);

/** A corporation: a small team of players sharing planets, deployables, and a treasury. */
export const corporations = pgTable("corporations", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  ceoId: integer("ceo_id").notNull(), // a member; no FK to avoid a players <-> corporations cycle
  credits: bigint("credits", { mode: "number" }).notNull().default(0),
  memo: text("memo").notNull().default(""),
  emblem: text("emblem"), // a CORP_EMBLEMS id, or null for none yet
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("corporations_game_idx").on(t.gameId)]);

export const players = pgTable("players", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }), // null for NPCs
  alias: text("alias").notNull(),
  sector: integer("sector").notNull(),
  credits: bigint("credits", { mode: "number" }).notNull(),
  turns: integer("turns").notNull(),
  experience: integer("experience").notNull().default(0),
  alignment: integer("alignment").notNull().default(0),
  ship: text("ship").notNull(),
  holds: integer("holds").notNull(),
  fighters: integer("fighters").notNull(),
  shields: integer("shields").notNull().default(0),
  cargoOre: integer("cargo_ore").notNull().default(0),
  cargoOrg: integer("cargo_org").notNull().default(0),
  cargoEqu: integer("cargo_equ").notNull().default(0),
  docked: boolean("docked").notNull().default(false),
  armids: integer("armids").notNull().default(0),
  limpets: integer("limpets").notNull().default(0),
  prevSector: integer("prev_sector"), // where you came from: always allowed as a retreat
  tollPaidSector: integer("toll_paid_sector"), // toll paid for the fighters in this sector
  lastReadMessageId: integer("last_read_message_id").notNull().default(0),
  cargoColonists: integer("cargo_colonists").notNull().default(0),
  genesis: integer("genesis").notNull().default(0),
  landedPlanetId: integer("landed_planet_id"),
  lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
  npc: text("npc").$type<NpcFaction>(), // null for human players
  npcRole: text("npc_role").$type<NpcRole>(),
  gear: jsonb("gear").$type<Gear>().notNull().default({}),
  cloaked: boolean("cloaked").notNull().default(false),
  corpId: integer("corp_id").references((): AnyPgColumn => corporations.id, { onDelete: "set null" }),
}, (t) => [
  uniqueIndex("players_game_user_idx").on(t.gameId, t.userId),
  uniqueIndex("players_game_alias_idx").on(t.gameId, t.alias),
  index("players_game_sector_idx").on(t.gameId, t.sector),
]);

export const visited = pgTable("visited", {
  playerId: integer("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  sectorId: integer("sector_id").notNull(),
}, (t) => [primaryKey({ columns: [t.playerId, t.sectorId] })]);

export const sectorFighters = pgTable("sector_fighters", {
  gameId: integer("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  sectorId: integer("sector_id").notNull(),
  ownerId: integer("owner_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  count: integer("count").notNull(),
  mode: text("mode").$type<"defensive" | "offensive" | "toll">().notNull(),
}, (t) => [primaryKey({ columns: [t.gameId, t.sectorId] })]);

export const sectorMines = pgTable("sector_mines", {
  gameId: integer("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  sectorId: integer("sector_id").notNull(),
  ownerId: integer("owner_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"armid" | "limpet">().notNull(),
  count: integer("count").notNull(),
}, (t) => [primaryKey({ columns: [t.gameId, t.sectorId, t.ownerId, t.kind] })]);

/** A limpet mine stuck to `targetId`'s hull, reporting to `ownerId`. */
export const limpetTags = pgTable("limpet_tags", {
  ownerId: integer("owner_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  targetId: integer("target_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.ownerId, t.targetId] })]);

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  kind: text("kind").notNull(),
  text: text("text").notNull(),
}, (t) => [index("messages_player_idx").on(t.playerId, t.id)]);

export const planets = pgTable("planets", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  sectorId: integer("sector_id").notNull(),
  name: text("name").notNull(),
  cls: text("cls").$type<"M" | "K" | "O" | "L" | "C" | "H" | "U">().notNull(),
  ownerId: integer("owner_id").references(() => players.id, { onDelete: "set null" }),
  colOre: integer("col_ore").notNull().default(0),
  colOrg: integer("col_org").notNull().default(0),
  colEqu: integer("col_equ").notNull().default(0),
  ore: integer("ore").notNull().default(0),
  org: integer("org").notNull().default(0),
  equ: integer("equ").notNull().default(0),
  fighters: integer("fighters").notNull().default(0),
  shields: integer("shields").notNull().default(0),
  credits: bigint("credits", { mode: "number" }).notNull().default(0),
  citadel: integer("citadel").notNull().default(0),
  buildDaysLeft: integer("build_days_left"), // non-null while the next level is under construction
  militaryPct: integer("military_pct").notNull().default(0),
  qSectorPct: integer("q_sector_pct").notNull().default(0),
  qAtmoPct: integer("q_atmo_pct").notNull().default(0),
  interdictor: boolean("interdictor").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("planets_game_sector_idx").on(t.gameId, t.sectorId)]);

/**
 * Per-faction state: the Maw's hidden home and credit treasury. Its fighter reserve is the
 * defensive stack in the home sector (owned by the Warlord), so players can whittle it down.
 */
export const factions = pgTable("factions", {
  gameId: integer("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  faction: text("faction").$type<NpcFaction>().notNull(),
  homeSector: integer("home_sector"),
  credits: bigint("credits", { mode: "number" }).notNull().default(0),
}, (t) => [primaryKey({ columns: [t.gameId, t.faction] })]);

/** A standing invitation from a corporation's CEO to a player. */
export const corpInvites = pgTable("corp_invites", {
  corpId: integer("corp_id").notNull().references(() => corporations.id, { onDelete: "cascade" }),
  playerId: integer("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.corpId, t.playerId] })]);

/** A marker beacon: one per sector, anyone arriving reads it. */
export const beacons = pgTable("beacons", {
  gameId: integer("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  sectorId: integer("sector_id").notNull(),
  ownerId: integer("owner_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.gameId, t.sectorId] })]);

/** A port that caught a player stealing or robbing refuses them until `until` (or someone else is caught there). */
export const portBusts = pgTable("port_busts", {
  gameId: integer("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  sectorId: integer("sector_id").notNull(),
  playerId: integer("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  until: timestamp("until", { withTimezone: true }).notNull(),
}, (t) => [primaryKey({ columns: [t.gameId, t.sectorId, t.playerId] })]);

/** A price on a player's head, posted at Keystone Station and paid to whoever destroys their ship. */
export const bounties = pgTable("bounties", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  targetId: integer("target_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  posterId: integer("poster_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  amount: bigint("amount", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("bounties_target_idx").on(t.targetId)]);

/** Notices pinned to the Keystone Station tavern board. */
export const tavernPosts = pgTable("tavern_posts", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  playerId: integer("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("tavern_posts_game_idx").on(t.gameId, t.id)]);
