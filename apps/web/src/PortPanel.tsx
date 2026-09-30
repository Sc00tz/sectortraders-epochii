import { useEffect, useState } from "react";
import { PLACE, COMMODITY_LABEL, type Commodity, type PortSlotDto, type QuoteDto, type StateDto } from "@st/shared";
import { api, fmt, type CrimeInfo, type ShopInfo } from "./api";
import { stationSpriteFor } from "./SectorScene";
import { ShopPanel } from "./ShopPanel";
import { Icon } from "./Icon";


export function PortPanel({ gameId, state, onState }: {
  gameId: number; state: StateDto; onState: (s: StateDto) => void;
}) {
  const port = state.sector.port;
  const p = state.player;
  const [qty, setQty] = useState<Record<string, string>>({});
  const [deal, setDeal] = useState<QuoteDto | null>(null);
  const [offer, setOffer] = useState("");
  const [msg, setMsg] = useState<{ text: string; tone?: "good" | "bad" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [crime, setCrime] = useState<CrimeInfo | null>(null);
  const [prices, setPrices] = useState<ShopInfo | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  useEffect(() => { api.shop(gameId).then(setPrices).catch(() => {}); }, [gameId]);

  // Leaving the sector ends any negotiation.
  useEffect(() => { setDeal(null); setMsg(null); setQty({}); }, [state.sector.id]);
  useEffect(() => {
    if (!state.docked || !port || port.cls === 0 || port.cls === 9) { setCrime(null); return; }
    api.crime(gameId).then(setCrime).catch(() => setCrime(null));
  }, [gameId, state.docked, state.sector.id, p.experience, p.alignment, port]);

  if (!port) return <p className="muted">No port in this sector.</p>;

  const free = p.holds - p.cargo.ore - p.cargo.org - p.cargo.equ - p.colonists;
  const maxFor = (s: PortSlotDto) => (s.dir === "sell"
    ? Math.min(s.stock, free, Math.floor(p.credits / Math.max(1, s.unitPrice)))
    : Math.min(s.stock, p.cargo[s.commodity]));

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { setMsg({ text: (e as Error).message, tone: "bad" }); } finally { setBusy(false); }
  };

  const askPrice = (s: PortSlotDto) => run(async () => {
    const n = Number(qty[s.commodity] ?? maxFor(s));
    const q = await api.quote(gameId, s.commodity as Commodity, n);
    setDeal(q);
    setOffer(String(q.quote));
    setMsg(null);
  });

  const submit = (amount: number) => deal && run(async () => {
    const r = await api.offer(gameId, amount);
    const what = `${deal.qty} ${COMMODITY_LABEL[deal.commodity]}`;
    if (r.result === "counter") {
      setDeal(r.quote);
      setOffer(String(r.quote.quote));
      setMsg({ text: r.message });
    } else if (r.result === "refused") {
      setDeal(null);
      setMsg({ text: `${r.message} (No deal on ${what}.)`, tone: "bad" });
      onState(r.state);
    } else {
      setDeal(null);
      const verb = deal.dir === "sell" ? "Bought" : "Sold";
      const text = `${verb} ${what} for ${fmt(r.price)} credits${r.xp ? ` (+${r.xp} XP for a sharp haggle)` : ""}.`;
      setMsg({ text, tone: "good" });
      onState(r.state);
    }
  });

  const special = port.cls === 0 || port.cls === 9;

  return (
    <div className="port">
      <div className="port-head">
        <img src={`/sprites/${stationSpriteFor(port)}.png`} alt="" />
        <div>
          <h3>{port.name}</h3>
          <div className="muted">{special ? (port.cls === 9 ? "Shipyard and hardware" : "Hardware depot") : `Class ${port.cls} · ${port.pattern}`}</div>
        </div>
      </div>

      {!state.docked ? (
        <button className="primary wide" disabled={busy} onClick={() => run(async () => { onState(await api.dock(gameId)); })}>Dock (1 turn)</button>
      ) : special ? (
        <ShopPanel gameId={gameId} state={state} onState={onState} stardock={port.cls === 9} />
      ) : (
        <>
          <table className="slots">
            <thead><tr><th>Cargo</th><th>Port</th><th>Units</th><th>Price</th><th /></tr></thead>
            <tbody>
              {port.slots.map((s) => {
                const max = maxFor(s);
                return (
                  <tr key={s.commodity}>
                    <td><span className="with-icon"><Icon item={s.commodity} />{COMMODITY_LABEL[s.commodity]}</span></td>
                    <td className={s.dir === "sell" ? "sells" : "buys"}>{s.dir === "sell" ? "Selling" : "Buying"}</td>
                    <td>{fmt(s.stock)}</td>
                    <td>{s.unitPrice.toFixed(1)}</td>
                    <td className="trade-cell">
                      <input
                        value={qty[s.commodity] ?? String(max)}
                        onChange={(e) => setQty({ ...qty, [s.commodity]: e.target.value.replace(/\D/g, "") })}
                        disabled={max < 1}
                      />
                      <button disabled={busy || max < 1 || !!deal} onClick={() => askPrice(s)}>{s.dir === "sell" ? "Buy" : "Sell"}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {prices && (
            <div className="upgrade">
              <button className="link" onClick={() => setUpgradeOpen(!upgradeOpen)}>{upgradeOpen ? "▾" : "▸"} Upgrade this port</button>
              {upgradeOpen && <>
                <div className="muted small">
                  Pay {fmt(prices.portUpgradeCostPerUnit)} credits per unit to grow what this port can hold, up to {fmt(prices.portMaxCapacity)}.
                  Bigger ports help every trader; every {fmt(prices.portUpgradeCreditsPerAlignment)} credits spent earns 1 alignment.
                </div>
                {port.slots.map((sl) => (
                  <div key={sl.commodity} className="action-row">
                    <span className="upgrade-label">{COMMODITY_LABEL[sl.commodity]} <span className="muted">holds {fmt(sl.max)}</span></span>
                    <input className="num" value={qty[`up_${sl.commodity}`] ?? ""} placeholder="0" onChange={(e) => setQty({ ...qty, [`up_${sl.commodity}`]: e.target.value.replace(/\D/g, "") })} />
                    <button disabled={busy || !Number(qty[`up_${sl.commodity}`]) || sl.max >= prices.portMaxCapacity}
                      onClick={() => run(async () => { const n = Number(qty[`up_${sl.commodity}`]); onState(await api.upgradePort(gameId, sl.commodity as Commodity, n)); setMsg({ text: `Added ${fmt(n)} ${COMMODITY_LABEL[sl.commodity]} capacity for ${fmt(n * prices.portUpgradeCostPerUnit)} credits.`, tone: "good" }); setQty({}); })}>
                      Upgrade{Number(qty[`up_${sl.commodity}`]) ? ` (${fmt(Number(qty[`up_${sl.commodity}`]) * prices.portUpgradeCostPerUnit)})` : ""}
                    </button>
                  </div>
                ))}
              </>}
            </div>
          )}

          {crime?.eligible && (
            <div className="crime">
              <h4>Back-room business</h4>
              <div className="muted small">
                With your reputation you could walk off with up to {fmt(crime.stealHolds)} units or {fmt(crime.robCredits)} credits.
                Get caught and they take cargo holds and some of your experience, and bar you for a while.
                {crime.heat > 0 && ` Security is already jumpy here (${crime.heat} incident${crime.heat > 1 ? "s" : ""} today).`}
              </div>
              {port.slots.filter((s) => s.dir === "sell").map((s) => (
                <div key={s.commodity} className="action-row">
                  <input className="num" value={qty[`st_${s.commodity}`] ?? ""} placeholder="0" onChange={(e) => setQty({ ...qty, [`st_${s.commodity}`]: e.target.value.replace(/\D/g, "") })} />
                  <button className="danger" disabled={busy || !Number(qty[`st_${s.commodity}`])}
                    onClick={() => run(async () => { const r = await api.steal(gameId, s.commodity as Commodity, Number(qty[`st_${s.commodity}`])); onState(r.state); setMsg({ text: r.report.join(" "), tone: r.state.docked ? "good" : "bad" }); setQty({}); })}>
                    Steal {COMMODITY_LABEL[s.commodity]} (1 turn)
                  </button>
                </div>
              ))}
              <div className="action-row">
                <input className="num" value={qty.rob ?? ""} placeholder="0" onChange={(e) => setQty({ ...qty, rob: e.target.value.replace(/\D/g, "") })} />
                <button className="danger" disabled={busy || !Number(qty.rob)}
                  onClick={() => run(async () => { const r = await api.rob(gameId, Number(qty.rob)); onState(r.state); setMsg({ text: r.report.join(" "), tone: r.state.docked ? "good" : "bad" }); setQty({}); })}>
                  Rob the till (1 turn)
                </button>
              </div>
            </div>
          )}

          {deal && (
            <div className="deal">
              <div>
                {deal.dir === "sell" ? "They want" : "They offer"} <strong>{fmt(deal.quote)}</strong> credits for {deal.qty} {COMMODITY_LABEL[deal.commodity]}
                <span className="muted"> ({(deal.quote / deal.qty).toFixed(1)} each)</span>
              </div>
              <div className="deal-row">
                <input value={offer} onChange={(e) => setOffer(e.target.value.replace(/\D/g, ""))} />
                <button disabled={busy || !offer} onClick={() => submit(Number(offer))}>Counter-offer</button>
                <button className="primary" disabled={busy} onClick={() => submit(deal.quote)}>Accept {fmt(deal.quote)}</button>
                <button className="link" onClick={() => { setDeal(null); setMsg(null); }}>Walk away</button>
              </div>
              <div className="muted small">
                {deal.dir === "sell" ? "Offer less to haggle." : "Ask for more to haggle."} Push too hard and they stop dealing. Round {deal.rounds + 1}.
              </div>
            </div>
          )}
        </>
      )}
      {msg && <div className={`port-msg ${msg.tone ?? ""}`}>{msg.text}</div>}
    </div>
  );
}
