import type {
  ActionResultDto, BountyDto, CorpPlanetDto, TavernPostDto, CorpDto, GameSettings, PlanetDto, FighterMode, GameSummaryDto, LimpetTrackDto, MapDto, MeDto, MessageDto, OfferResultDto, QuoteDto,
  ShipyardEntryDto, StateDto, Commodity,
} from "@st/shared";

export interface ShopInfo {
  fighters: number; shields: number; nextHold: number; armid: number; limpet: number; limpetRemoval: number;
  holdPriceBase: number; holdPriceStep: number; maxMinesCarried: number; genesis: number; maxGenesisCarried: number;
  gear: Record<string, { price: number; max: number }>;
  tavernPostPrice: number; tavernRumorPrice: number; tavernTracePrice: number;
  commissionAlignment: number; commissionGrant: number; bountyMin: number; bountyCreditsPerAlignment: number;
  portUpgradeCostPerUnit: number; portUpgradeCreditsPerAlignment: number; portMaxCapacity: number;
}

export interface CrimeInfo { eligible: boolean; thiefAlignment: number; stealHolds: number; robCredits: number; heat: number }

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body !== undefined || method === "POST" ? { "content-type": "application/json" } : undefined,
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  me: () => call<MeDto>("GET", "/api/me"),
  login: (username: string, password: string) => call<MeDto>("POST", "/api/auth/login", { username, password }),
  register: (username: string, password: string) => call<MeDto>("POST", "/api/auth/register", { username, password }),
  logout: () => call<{ ok: true }>("POST", "/api/auth/logout"),
  games: () => call<GameSummaryDto[]>("GET", "/api/games"),
  createGame: (name: string, settings: Record<string, unknown>) => call<{ id: number }>("POST", "/api/admin/games", { name, settings }),
  adminSettings: (id: number) => call<{ id: number; name: string; settings: GameSettings }>("GET", `/api/admin/games/${id}/settings`),
  saveAdminSettings: (id: number, settings: Record<string, unknown>) => call<{ id: number; settings: GameSettings }>("POST", `/api/admin/games/${id}/settings`, { settings }),
  join: (id: number, alias: string) => call<StateDto>("POST", `/api/games/${id}/join`, { alias }),
  state: (id: number) => call<StateDto>("GET", `/api/games/${id}/state`),
  map: (id: number) => call<MapDto>("GET", `/api/games/${id}/map`),
  move: (id: number, to: number) => call<ActionResultDto>("POST", `/api/games/${id}/move`, { to }),
  course: (id: number, to: number) => call<{ path: number[]; turns: number }>("GET", `/api/games/${id}/course?to=${to}`),
  autopilot: (id: number, to: number) =>
    call<{ moved: number; planned: number; stoppedEarly: boolean; report: string[]; state: StateDto }>("POST", `/api/games/${id}/autopilot`, { to }),
  dock: (id: number) => call<StateDto>("POST", `/api/games/${id}/port/dock`),
  quote: (id: number, commodity: Commodity, qty: number) => call<QuoteDto>("POST", `/api/games/${id}/port/quote`, { commodity, qty }),
  offer: (id: number, offer: number) => call<OfferResultDto>("POST", `/api/games/${id}/port/offer`, { offer }),
  shop: (id: number) => call<ShopInfo>("GET", `/api/games/${id}/shop`),
  buy: (id: number, item: string, qty: number) => call<StateDto>("POST", `/api/games/${id}/shop/buy`, { item, qty }),
  shipyard: (id: number) => call<ShipyardEntryDto[]>("GET", `/api/games/${id}/shipyard`),
  buyShip: (id: number, ship: string) => call<StateDto>("POST", `/api/games/${id}/shipyard/buy`, { ship }),
  removeLimpets: (id: number) => call<StateDto>("POST", `/api/games/${id}/stardock/remove-limpets`),
  limpets: (id: number) => call<LimpetTrackDto[]>("GET", `/api/games/${id}/limpets`),
  attack: (id: number, target: number, fighters: number) => call<ActionResultDto>("POST", `/api/games/${id}/attack`, { target, fighters }),
  attackFighters: (id: number, fighters: number) => call<ActionResultDto>("POST", `/api/games/${id}/attack-fighters`, { fighters }),
  deploy: (id: number, count: number, mode: FighterMode) => call<StateDto>("POST", `/api/games/${id}/fighters/deploy`, { count, mode }),
  retrieve: (id: number, count: number) => call<StateDto>("POST", `/api/games/${id}/fighters/retrieve`, { count }),
  layMines: (id: number, kind: "armid" | "limpet", count: number) => call<StateDto>("POST", `/api/games/${id}/mines/lay`, { kind, count }),
  payToll: (id: number) => call<StateDto>("POST", `/api/games/${id}/toll/pay`),
  genesis: (id: number, name: string) => call<ActionResultDto>("POST", `/api/games/${id}/planet/genesis`, { name }),
  land: (id: number, planet: number) => call<StateDto>("POST", `/api/games/${id}/planet/land`, { planet }),
  liftOff: (id: number) => call<StateDto>("POST", `/api/games/${id}/planet/leave`),
  planet: (id: number) => call<PlanetDto>("GET", `/api/games/${id}/planet`),
  planetTransfer: (id: number, what: string, amount: number, group?: string) => call<StateDto>("POST", `/api/games/${id}/planet/transfer`, { what, amount, group }),
  planetAssign: (id: number, split: { ore: number; org: number; equ: number }) => call<PlanetDto>("POST", `/api/games/${id}/planet/assign`, split),
  treasury: (id: number, amount: number) => call<StateDto>("POST", `/api/games/${id}/planet/treasury`, { amount }),
  buildCitadel: (id: number) => call<PlanetDto>("POST", `/api/games/${id}/planet/citadel`),
  planetSettings: (id: number, v: { militaryPct?: number; qSectorPct?: number; qAtmoPct?: number; interdictor?: boolean }) => call<PlanetDto>("POST", `/api/games/${id}/planet/settings`, v),
  planetShields: (id: number, shields: number) => call<StateDto>("POST", `/api/games/${id}/planet/shields`, { shields }),
  planetWarp: (id: number, to: number) => call<ActionResultDto>("POST", `/api/games/${id}/planet/warp`, { to }),
  attackPlanet: (id: number, planet: number, fighters: number) => call<ActionResultDto>("POST", `/api/games/${id}/planet/attack`, { planet, fighters }),
  loadColonists: (id: number, qty: number) => call<StateDto>("POST", `/api/games/${id}/colonists/load`, { qty }),
  messages: (id: number) => call<MessageDto[]>("GET", `/api/games/${id}/messages`),
  markRead: (id: number) => call<{ ok: true }>("POST", `/api/games/${id}/messages/read`),
  corp: (id: number) => call<{ corp: CorpDto | null }>("GET", `/api/games/${id}/corp`).then((r) => r.corp),
  corpCreate: (id: number, name: string) => call<StateDto>("POST", `/api/games/${id}/corp/create`, { name }),
  corpInvite: (id: number, alias: string) => call<CorpDto>("POST", `/api/games/${id}/corp/invite`, { alias }),
  corpUninvite: (id: number, player: number) => call<CorpDto>("POST", `/api/games/${id}/corp/uninvite`, { player }),
  corpAccept: (id: number, corp: number) => call<StateDto>("POST", `/api/games/${id}/corp/accept`, { corp }),
  corpDecline: (id: number, corp: number) => call<StateDto>("POST", `/api/games/${id}/corp/decline`, { corp }),
  corpLeave: (id: number) => call<StateDto>("POST", `/api/games/${id}/corp/leave`),
  corpExpel: (id: number, player: number) => call<CorpDto>("POST", `/api/games/${id}/corp/expel`, { player }),
  corpHandOver: (id: number, player: number) => call<CorpDto>("POST", `/api/games/${id}/corp/handover`, { player }),
  corpDisband: (id: number) => call<StateDto>("POST", `/api/games/${id}/corp/disband`),
  corpDeposit: (id: number, amount: number) => call<StateDto>("POST", `/api/games/${id}/corp/deposit`, { amount }),
  corpWithdraw: (id: number, amount: number) => call<StateDto>("POST", `/api/games/${id}/corp/withdraw`, { amount }),
  corpMemo: (id: number, text: string) => call<CorpDto>("POST", `/api/games/${id}/corp/memo`, { text }),
  corpEmblem: (id: number, emblem: string | null) => call<CorpDto>("POST", `/api/games/${id}/corp/emblem`, { emblem }),
  corpEmblemsTaken: (id: number) => call<{ taken: { emblem: string; corp: string }[] }>("GET", `/api/games/${id}/corp/emblems`),
  corpSay: (id: number, text: string) => call<{ ok: true }>("POST", `/api/games/${id}/corp/say`, { text }),
  transwarp: (id: number, to: number) => call<ActionResultDto>("POST", `/api/games/${id}/transwarp`, { to }),
  densityScan: (id: number) => call<ActionResultDto>("POST", `/api/games/${id}/scan/density`),
  holoScan: (id: number) => call<ActionResultDto>("POST", `/api/games/${id}/scan/holo`),
  planetScan: (id: number, planet: number) => call<PlanetDto>("POST", `/api/games/${id}/scan/planet`, { planet }),
  probe: (id: number, to: number) => call<ActionResultDto>("POST", `/api/games/${id}/probe`, { to }),
  photon: (id: number, sector: number) => call<ActionResultDto>("POST", `/api/games/${id}/photon`, { sector }),
  cloak: (id: number) => call<StateDto>("POST", `/api/games/${id}/cloak`),
  disruptor: (id: number, sector: number) => call<ActionResultDto>("POST", `/api/games/${id}/disruptor`, { sector }),
  beacon: (id: number, message: string) => call<StateDto>("POST", `/api/games/${id}/beacon`, { message }),
  removeBeacon: (id: number) => call<StateDto>("POST", `/api/games/${id}/beacon/remove`),
  detonate: (id: number) => call<ActionResultDto>("POST", `/api/games/${id}/planet/detonate`),
  crime: (id: number) => call<CrimeInfo>("GET", `/api/games/${id}/port/crime`),
  steal: (id: number, commodity: Commodity, qty: number) => call<ActionResultDto>("POST", `/api/games/${id}/port/steal`, { commodity, qty }),
  rob: (id: number, amount: number) => call<ActionResultDto>("POST", `/api/games/${id}/port/rob`, { amount }),
  commission: (id: number) => call<StateDto>("POST", `/api/games/${id}/office/commission`),
  bounties: (id: number) => call<BountyDto[]>("GET", `/api/games/${id}/office/bounties`),
  postBounty: (id: number, alias: string, amount: number) => call<StateDto>("POST", `/api/games/${id}/office/bounty`, { alias, amount }),
  upgradePort: (id: number, commodity: Commodity, qty: number) => call<StateDto>("POST", `/api/games/${id}/port/upgrade`, { commodity, qty }),
  sendDirect: (id: number, alias: string, text: string) => call<{ ok: true }>("POST", `/api/games/${id}/comms/direct`, { alias, text }),
  radio: (id: number, text: string) => call<{ ok: true }>("POST", `/api/games/${id}/comms/radio`, { text }),
  broadcast: (id: number, text: string) => call<{ ok: true }>("POST", `/api/games/${id}/comms/broadcast`, { text }),
  tavern: (id: number) => call<TavernPostDto[]>("GET", `/api/games/${id}/tavern`),
  tavernPost: (id: number, text: string) => call<StateDto>("POST", `/api/games/${id}/tavern/post`, { text }),
  rumor: (id: number) => call<{ line: string; state: StateDto }>("POST", `/api/games/${id}/tavern/rumor`),
  trace: (id: number, alias: string) => call<{ line: string; state: StateDto }>("POST", `/api/games/${id}/tavern/trace`, { alias }),
  corpPlanetScan: (id: number) => call<CorpPlanetDto[]>("GET", `/api/games/${id}/planet/corp-scan`),
  adminReset: (id: number) => call<{ ok: true }>("POST", `/api/admin/games/${id}/reset`),
};

export const fmt = (n: number) => n.toLocaleString("en-US");
