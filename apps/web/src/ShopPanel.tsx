import { useEffect, useState } from "react";
import { GEAR, SHIP_TYPES, holdsCost, type BountyDto, type ReliefDto, type ShipyardEntryDto, type StateDto, type TavernPostDto } from "@st/shared";
import { api, fmt, type ShopInfo } from "./api";
import { Icon } from "./Icon";

type Item = "fighters" | "shields" | "holds" | "armid" | "limpet" | "genesis";

/** Hardware counter (special depots and Stardock) plus the Stardock shipyard. */
export function ShopPanel({ gameId, state, onState, stardock }: {
  gameId: number; state: StateDto; onState: (s: StateDto) => void; stardock: boolean;
}) {
  const p = state.player;
  const ship = SHIP_TYPES[p.ship]!;
  const [info, setInfo] = useState<ShopInfo | null>(null);
  const [yard, setYard] = useState<ShipyardEntryDto[] | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ text: string; tone?: "good" | "bad" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [wanted, setWanted] = useState<BountyDto[]>([]);
  const [board, setBoard] = useState<TavernPostDto[]>([]);
  const [keeper, setKeeper] = useState<string | null>(null);
  const [relief, setRelief] = useState<ReliefDto | null>(null);

  useEffect(() => {
    api.shop(gameId).then(setInfo).catch(() => {});
    if (stardock) api.shipyard(gameId).then(setYard).catch(() => {});
    if (stardock) api.bounties(gameId).then(setWanted).catch(() => {});
    if (stardock) api.tavern(gameId).then(setBoard).catch(() => {});
    if (stardock) api.relief(gameId).then(setRelief).catch(() => setRelief(null));
  }, [gameId, stardock, p.credits, p.ship, p.holds]);

  if (!info) return <p className="muted">Loading prices…</p>;

  const room: Record<Item, number> = {
    fighters: ship.maxFighters - p.fighters,
    shields: ship.maxShields - p.shields,
    holds: ship.maxHolds - p.holds,
    armid: p.ship === "escape_pod" ? 0 : info.maxMinesCarried - p.armids,
    limpet: p.ship === "escape_pod" ? 0 : info.maxMinesCarried - p.limpets,
    genesis: p.ship === "escape_pod" ? 0 : info.maxGenesisCarried - p.genesis,
  };
  const costOf = (item: Item, n: number) => item === "holds" ? holdsCost(info, p.holds, n)
    : n * (item === "fighters" ? info.fighters : item === "shields" ? info.shields : item === "armid" ? info.armid : item === "genesis" ? info.genesis : info.limpet);
  const affordable = (item: Item) => {
    let n = 0;
    while (n < room[item] && costOf(item, n + 1) <= p.credits) n++;
    return n;
  };

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    try { setMsg({ text: await fn(), tone: "good" }); } catch (e) { setMsg({ text: (e as Error).message, tone: "bad" }); } finally { setBusy(false); }
  };

  const rows: { item: Item; label: string; have: string; unit: string }[] = [
    { item: "holds", label: "Cargo holds", have: `${p.holds} / ${ship.maxHolds}`, unit: `${fmt(info.nextHold)} next` },
    { item: "fighters", label: "Fighters", have: `${fmt(p.fighters)} / ${fmt(ship.maxFighters)}`, unit: fmt(info.fighters) },
    { item: "shields", label: "Shields", have: `${fmt(p.shields)} / ${fmt(ship.maxShields)}`, unit: fmt(info.shields) },
    ...(stardock ? [
      { item: "armid" as Item, label: "Burst mines", have: `${p.armids} / ${info.maxMinesCarried}`, unit: fmt(info.armid) },
      { item: "limpet" as Item, label: "Limpet mines", have: `${p.limpets} / ${info.maxMinesCarried}`, unit: fmt(info.limpet) },
      { item: "genesis" as Item, label: "Genesis torpedoes", have: `${p.genesis} / ${info.maxGenesisCarried}`, unit: fmt(info.genesis) },
    ] : []),
  ];

  return (
    <div className="shop">
      <h3>Hardware</h3>
      <table className="slots">
        <thead><tr><th>Item</th><th>You have</th><th>Price</th><th /></tr></thead>
        <tbody>
          {rows.map((r) => {
            const max = affordable(r.item);
            const n = Number(qty[r.item] ?? Math.min(max, r.item === "holds" || r.item === "genesis" ? 1 : max));
            return (
              <tr key={r.item}>
                <td><span className="with-icon"><Icon item={r.item} />{r.label}</span></td>
                <td>{r.have}</td>
                <td>{r.unit}</td>
                <td className="trade-cell">
                  <input value={qty[r.item] ?? String(Math.min(max, r.item === "holds" || r.item === "genesis" ? 1 : max))} disabled={max < 1}
                    onChange={(e) => setQty({ ...qty, [r.item]: e.target.value.replace(/\D/g, "") })} />
                  <button disabled={busy || max < 1 || !(n > 0)} title={n > 0 ? `${fmt(costOf(r.item, n))} credits` : ""}
                    onClick={() => run(async () => { onState(await api.buy(gameId, r.item, n)); setQty({ ...qty, [r.item]: "" }); return `Bought ${n} ${r.label.toLowerCase()} for ${fmt(costOf(r.item, n))} credits.`; })}>
                    Buy
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="muted small">Holds cost {fmt(info.holdPriceBase)} + {fmt(info.holdPriceStep)} per hold you already own.</div>

      {stardock && (
        <>
          {p.limpetsAttached > 0 && (
            <div className="alert bad">
              {p.limpetsAttached} limpet{p.limpetsAttached > 1 ? "s are" : " is"} stuck to your hull, reporting your position.
              <button disabled={busy || p.credits < info.limpetRemoval} onClick={() => run(async () => { onState(await api.removeLimpets(gameId)); return "Limpets removed."; })}>
                Remove ({fmt(info.limpetRemoval)})
              </button>
            </div>
          )}
          <h3>Equipment</h3>
          <table className="slots gear-table">
            <thead><tr><th>Item</th><th>You have</th><th>Price</th><th /></tr></thead>
            <tbody>
              {GEAR.map((g) => {
                const gi = info.gear[g.id]!;
                const have = p.gear[g.id] ?? 0;
                const hullOk = g.id !== "transwarp" || ship.transwarp;
                const room = p.ship === "escape_pod" || !hullOk ? 0 : gi.max - have;
                const afford = Math.min(room, Math.floor(p.credits / Math.max(1, gi.price)));
                const key = `g_${g.id}`;
                const n = g.kind === "flag" ? 1 : Number(qty[key] ?? Math.min(afford, 1));
                return (
                  <tr key={g.id}>
                    <td><span className="with-icon"><Icon item={g.id} size={28} /><span>{g.label}<div className="muted small">{g.blurb}</div></span></span></td>
                    <td>{g.kind === "flag" ? (have ? "Installed" : hullOk ? "—" : "Hull can't take one") : `${fmt(have)} / ${fmt(gi.max)}`}</td>
                    <td>{fmt(gi.price)}</td>
                    <td className="trade-cell">
                      {g.kind === "count" && <input value={qty[key] ?? String(Math.min(afford, 1))} disabled={afford < 1}
                        onChange={(e) => setQty({ ...qty, [key]: e.target.value.replace(/\D/g, "") })} />}
                      <button disabled={busy || afford < 1 || !(n > 0) || n > afford}
                        onClick={() => run(async () => { onState(await api.buy(gameId, g.id, n)); setQty({ ...qty, [key]: "" }); return `Bought ${g.kind === "flag" ? `a ${g.label.toLowerCase()}` : `${n} ${g.label.toLowerCase()}${n === 1 ? "" : "s"}`} for ${fmt(n * gi.price)} credits.`; })}>
                        Buy
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <h3>The tavern</h3>
          <div className="tavern">
            <img className="keeper" src="/sprites/portrait_tavern_keeper.png" alt="The tavern keeper" />
            <div className="tavern-talk">
              <div className="keeper-line">{keeper ?? "\"What'll it be, pilot? Drinks are free for regulars. Information isn't.\""}</div>
              <div className="action-row">
                <button disabled={busy || p.credits < info.tavernRumorPrice}
                  onClick={() => run(async () => { const r = await api.rumor(gameId); onState(r.state); setKeeper(r.line); return `Paid ${fmt(info.tavernRumorPrice)} credits for a rumor.`; })}>
                  Buy a rumor ({fmt(info.tavernRumorPrice)})
                </button>
              </div>
              <div className="action-row">
                <input value={qty.trace ?? ""} placeholder="Trader's name" onChange={(e) => setQty({ ...qty, trace: e.target.value })} />
                <button disabled={busy || !(qty.trace ?? "").trim() || p.credits < info.tavernTracePrice}
                  onClick={() => run(async () => { const r = await api.trace(gameId, qty.trace ?? ""); onState(r.state); setKeeper(r.line); setQty({ ...qty, trace: "" }); return "The keeper pockets the credits."; })}>
                  Ask where they were seen ({fmt(info.tavernTracePrice)})
                </button>
              </div>
            </div>
          </div>
          <h4 className="board-head">Notice board</h4>
          <div className="action-row">
            <input className="notice-input" value={qty.notice ?? ""} maxLength={200} placeholder="Pin a notice for every pilot who stops by" onChange={(e) => setQty({ ...qty, notice: e.target.value })} />
            <button disabled={busy || !(qty.notice ?? "").trim() || p.credits < info.tavernPostPrice}
              onClick={() => run(async () => { onState(await api.tavernPost(gameId, qty.notice ?? "")); setBoard(await api.tavern(gameId)); setQty({ ...qty, notice: "" }); return "Notice pinned."; })}>
              Pin it ({fmt(info.tavernPostPrice)})
            </button>
          </div>
          <ul className="board">
            {board.length === 0 && <li className="muted small">The board is empty.</li>}
            {board.map((b) => (
              <li key={b.id}><span className="muted small">{new Date(b.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {b.alias}</span><div>{b.text}</div></li>
            ))}
          </ul>

          <h3>Authority office</h3>
          {/* The hardship fund: only shown to a pilot poor enough for it to matter, so it stays out of the way. */}
          {relief && (relief.available || p.credits < relief.grant) && (relief.available ? (
            <div className="alert">
              <span>The hardship fund will stake you {fmt(relief.grant)} credits to get you trading again. Once a day, for pilots with nothing left.</span>
              <button className="primary" disabled={busy}
                onClick={() => run(async () => { onState(await api.claimRelief(gameId)); setRelief(null); return `The Authority staked you ${fmt(relief.grant)} credits.`; })}>
                Claim a stake
              </button>
            </div>
          ) : <div className="muted small">Hardship fund: {relief.reason}</div>)}
          {p.alignment >= info.commissionGrant ? <div className="muted small">You hold an Authority commission.</div>
            : p.alignment >= info.commissionAlignment ? (
              <div className="action-row">
                <span>Your record qualifies you for a commission (alignment raised to {fmt(info.commissionGrant)}, and the Warden becomes available).</span>
                <button className="primary" disabled={busy} onClick={() => run(async () => { onState(await api.commission(gameId)); return "Commission granted. Congratulations, Captain."; })}>Request commission</button>
              </div>
            ) : <div className="muted small">Commissions go to pilots with {fmt(info.commissionAlignment)} alignment or more (you have {fmt(p.alignment)}).</div>}
          <div className="action-row">
            <input value={qty.bountyAlias ?? ""} placeholder="Evil trader's name" onChange={(e) => setQty({ ...qty, bountyAlias: e.target.value })} />
            <input className="num" value={qty.bountyAmt ?? ""} placeholder={String(info.bountyMin)} onChange={(e) => setQty({ ...qty, bountyAmt: e.target.value.replace(/\D/g, "") })} />
            <button disabled={busy || !(qty.bountyAlias ?? "").trim() || Number(qty.bountyAmt) < info.bountyMin}
              onClick={() => run(async () => { onState(await api.postBounty(gameId, qty.bountyAlias ?? "", Number(qty.bountyAmt))); setWanted(await api.bounties(gameId)); setQty({ ...qty, bountyAlias: "", bountyAmt: "" }); return "Bounty posted."; })}>
              Post bounty
            </button>
          </div>
          <div className="muted small">Paid to whoever destroys their ship. Every {fmt(info.bountyCreditsPerAlignment)} credits you post earns 1 alignment.</div>
          {wanted.length > 0 && (
            <table className="slots">
              <thead><tr><th>Most wanted</th><th>Alignment</th><th>Bounty</th></tr></thead>
              <tbody>{wanted.map((w) => <tr key={w.targetId}><td>{w.alias}</td><td className="evil">{fmt(w.alignment)}</td><td>{fmt(w.total)}</td></tr>)}</tbody>
            </table>
          )}

          <h3>Shipyard</h3>
          <div className="muted small">Your {ship.name} trades in for {yard?.[0] ? fmt(yard[0].tradeIn) : "…"} credits. Fighters, shields and holds carry over up to the new hull's limits.</div>
          <div className="yard">
            {(yard ?? []).map((y) => {
              const t = SHIP_TYPES[y.id]!;
              return (
                <div key={y.id} className={`yard-card${y.available ? "" : " dim"}`}>
                  <img src={`/sprites/${t.sprite}.png`} alt="" />
                  <div className="yard-info">
                    <strong>{y.name}</strong>
                    <span className="muted small">{t.turnsPerWarp} turns/jump · {t.maxHolds} holds · {fmt(t.maxFighters)} fighters · {fmt(t.maxShields)} shields · odds {t.offensiveOdds}{t.defensiveOdds !== t.offensiveOdds ? ` (${t.defensiveOdds} def)` : ""}</span>
                    <span>{fmt(y.price)} {y.tradeIn ? <span className="muted">− {fmt(y.tradeIn)} = <strong>{fmt(y.net)}</strong></span> : null}</span>
                    {y.reason && <span className="muted small">{y.reason}</span>}
                  </div>
                  <button className="primary" disabled={busy || !y.available}
                    onClick={() => run(async () => { onState(await api.buyShip(gameId, y.id)); return `Welcome aboard your new ${y.name}.`; })}>
                    Buy
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
      {msg && <div className={`port-msg ${msg.tone ?? ""}`}>{msg.text}</div>}
    </div>
  );
}
