import type { Commodity } from "./commodities";
import type { TradeDir } from "./ports";
import type { NpcFaction, NpcRole } from "./npc";
import type { Gear } from "./gear";

/** Shapes exchanged between server and browser. */

export interface MeDto {
  id: number;
  username: string;
  isAdmin: boolean;
}

export interface GameSummaryDto {
  id: number;
  name: string;
  sectors: number;
  players: number;
  joined: boolean;
  alias: string | null;
}

export interface PlayerDto {
  id: number;
  alias: string;
  sector: number;
  credits: number;
  turns: number;
  experience: number;
  alignment: number;
  ship: string;
  holds: number;
  fighters: number;
  shields: number;
  cargo: Record<Commodity, number>;
  armids: number;
  limpets: number;
  limpetsAttached: number; // enemy limpets stuck to your hull
  unread: number; // unread log messages
  colonists: number; // aboard, in cargo holds
  genesis: number; // Genesis torpedoes carried
  landedPlanetId: number | null;
  corp: { id: number; name: string; ceo: boolean; emblem: string | null } | null;
  gear: Gear;
  cloaked: boolean;
  /** Ports that refuse you after a bust: sector -> date it lifts. */
  bustedAt: { sector: number; until: string }[];
  corpInvites: { corpId: number; name: string; from: string }[];
}

export interface CorpMemberDto {
  id: number;
  alias: string;
  ship: string;
  sector: number;
  ceo: boolean;
  lastSeen: string;
}

export interface CorpDto {
  id: number;
  name: string;
  ceo: string;
  credits: number;
  memo: string;
  emblem: string | null;
  maxMembers: number;
  members: CorpMemberDto[];
  invited: { id: number; alias: string }[]; // pending invitations (CEO's view)
}

export interface PortSlotDto {
  commodity: Commodity;
  dir: TradeDir;
  stock: number;
  max: number;
  unitPrice: number; // current price for one unit
}

export interface PortDto {
  name: string;
  cls: number;
  pattern: string;
  slots: PortSlotDto[]; // empty for special ports
}

export interface SectorDto {
  id: number;
  x: number;
  y: number;
  fedspace: boolean;
  warps: number[];
  port: PortDto | null;
  traders: TraderDto[];
  fighters: { owner: string; mine: boolean; corp: boolean; count: number; mode: FighterMode } | null; // corp = a corpmate's (yours to use)
  myMines: { armid: number; limpet: number };
  planets: PlanetSummaryDto[];
  /** Colonists waiting at the home world (sector 1 only). */
  homeColonists: number | null;
  beacon: { owner: string; message: string; mine: boolean } | null;
  /** Until when a photon wave has knocked out fighters and planet defenses here. */
  photonUntil: string | null;
  /** Set when enemy fighters here stop you leaving (except back the way you came). */
  blocked: { reason: string; tollDue: number | null; backTo: number | null } | null;
}

export interface TraderDto {
  id: number;
  alias: string;
  ship: string;
  protected: boolean;
  corp: string | null; // corporation name, if any
  corpEmblem: string | null;
  corpmate: boolean;
  rank: string | null; // title for human traders
  /** Set for NPCs. */
  npc: { faction: NpcFaction; role: NpcRole; portrait: string | null; hostile: boolean; attackable: boolean; note: string | null } | null;
}

export type FighterMode = "defensive" | "offensive" | "toll";

export interface MessageDto {
  id: number;
  at: string;
  kind: string;
  text: string;
  read: boolean;
}

export interface ShipyardEntryDto {
  id: string;
  name: string;
  price: number;
  tradeIn: number;
  net: number; // price minus trade-in
  available: boolean;
  reason: string | null;
}

export interface LimpetTrackDto {
  targetId: number;
  alias: string;
  sector: number;
}

/** Result of anything that can hurt: attacks, arrivals into hazards. */
export interface ActionResultDto {
  state: StateDto;
  report: string[];
}

export interface StateDto {
  game: { id: number; name: string; sectors: number; turnsPerDay: number };
  player: PlayerDto;
  sector: SectorDto;
  docked: boolean;
}

export interface MapSectorDto {
  id: number;
  x: number;
  y: number;
  visited: boolean;
  port: string | null; // pattern code when known
  warps: number[]; // only for visited sectors
}

export interface MapDto {
  sectors: MapSectorDto[];
  current: number;
}

/** A sector a trader has given a name of their own, so they can find it again. */
export interface BookmarkDto {
  sector: number;
  label: string;
}

/**
 * The Authority's hardship fund, as offered at Keystone Station. `available` is false with a
 * `reason` when the pilot still has something to sell, or has already claimed today.
 */
export interface ReliefDto {
  available: boolean;
  grant: number;
  reason: string | null;
}

export interface QuoteDto {
  commodity: Commodity;
  dir: TradeDir; // port side
  qty: number;
  quote: number;
  rounds: number;
}

export type OfferResultDto =
  | { result: "accepted"; price: number; xp: number; state: StateDto }
  | { result: "counter"; quote: QuoteDto; message: string }
  | { result: "refused"; message: string; state: StateDto };

export interface SectorEventDto {
  kind: "arrive" | "depart" | "trade" | "reset" | "combat" | "deploy";
  sector: number;
  alias: string;
  ship?: string;
  message: string;
}

export interface PlanetSummaryDto {
  id: number;
  name: string;
  cls: string;
  owner: string | null;
  ownerEmblem: string | null; // the owner's corporation emblem
  mine: boolean; // yours or a corpmate's
  corp: boolean; // a corpmate's
  citadel: number;
  shielded: boolean;
  interdictor: boolean;
}

export interface PlanetDto {
  id: number;
  name: string;
  cls: string;
  sector: number;
  owner: string | null;
  mine: boolean;
  colonists: { ore: number; org: number; equ: number };
  maxColonists: number;
  stock: { ore: number; org: number; equ: number };
  fighters: number;
  shields: number;
  credits: number;
  citadel: number;
  building: { level: number; daysLeft: number } | null;
  nextLevel: { level: number; colonists: number; ore: number; org: number; equ: number; days: number } | null;
  production: { ore: number; org: number; equ: number; fighters: number };
  militaryPct: number;
  qSectorPct: number;
  qAtmoPct: number;
  interdictor: boolean;
}

/** The Authority's most-wanted list: open bounties per target. */
export interface BountyDto {
  targetId: number;
  alias: string;
  alignment: number;
  total: number;
  posters: number;
}

export interface TavernPostDto {
  id: number;
  alias: string;
  text: string;
  at: string;
}

/** One row of a corporate planet scan (from a citadel): every planet you and your corpmates own. */
export interface CorpPlanetDto {
  id: number;
  name: string;
  cls: string;
  sector: number;
  owner: string;
  citadel: number;
  building: boolean;
  fighters: number;
  shields: number;
  colonists: number;
  stock: { ore: number; org: number; equ: number };
  credits: number;
}
