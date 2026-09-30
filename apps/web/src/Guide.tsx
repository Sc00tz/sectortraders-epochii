import { useEffect, type ReactNode } from "react";
import {
  CITADEL_LEVELS, DEFAULT_SETTINGS as S, EVIL_TITLES, FACTIONS, GEAR, GOOD_TITLES, PLACE, PLANET_CLASSES, SHIP_TYPES,
  citadelCost, type PlanetClassId,
} from "@st/shared";
import { Icon } from "./Icon";

/**
 * The in-game "How to play" guide. Numbers come from the default settings, and the ship, equipment,
 * rank and planet tables are built from the game's own data, so they stay in step with the code.
 * An admin can change most numbers per galaxy; the guide says "by default" where that matters.
 */

const n = (x: number) => x.toLocaleString();
const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;

const SECTIONS: { id: string; title: string }[] = [
  { id: "start", title: "Getting started" },
  { id: "screen", title: "The game screen" },
  { id: "turns", title: "Turns and the daily reset" },
  { id: "moving", title: "Moving around" },
  { id: "trading", title: "Trading" },
  { id: "haggling", title: "Haggling" },
  { id: "ships", title: "Your ship and the shipyard" },
  { id: "keystone", title: "Keystone Station and the depots" },
  { id: "equipment", title: "Equipment" },
  { id: "combat", title: "Combat" },
  { id: "deploy", title: "Fighters and mines" },
  { id: "ranks", title: "Experience, alignment and rank" },
  { id: "crime", title: "Crime" },
  { id: "planets", title: "Planets" },
  { id: "citadels", title: "Citadels" },
  { id: "corps", title: "Corporations" },
  { id: "talk", title: "Messages and the tavern" },
  { id: "npcs", title: "Who else is out there" },
  { id: "tips", title: "Tips for new pilots" },
];

function Shot({ src, caption, narrow }: { src: string; caption: string; narrow?: boolean }) {
  return (
    <figure className={`guide-shot${narrow ? " narrow" : ""}`}>
      <a href={`/guide/${src}`} target="_blank" rel="noreferrer"><img src={`/guide/${src}`} alt={caption} loading="lazy" /></a>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

function Section({ id, children }: { id: string; children: ReactNode }) {
  const title = SECTIONS.find((s) => s.id === id)!.title;
  return <section id={`g-${id}`} className="guide-section"><h2>{title}</h2>{children}</section>;
}

const PORT_ROWS: [number, string, string][] = [
  [1, "BBS", "Buys Fuel Ore and Organics, sells Equipment"],
  [2, "BSB", "Buys Fuel Ore and Equipment, sells Organics"],
  [3, "SBB", "Sells Fuel Ore, buys Organics and Equipment"],
  [4, "SSB", "Sells Fuel Ore and Organics, buys Equipment"],
  [5, "SBS", "Sells Fuel Ore and Equipment, buys Organics"],
  [6, "BSS", "Buys Fuel Ore, sells Organics and Equipment"],
  [7, "SSS", "Sells all three"],
  [8, "BBB", "Buys all three"],
];

export function Guide({ onBack, backLabel }: { onBack: () => void; backLabel: string }) {
  // Deep links: #guide/<section>
  useEffect(() => {
    const m = location.hash.match(/^#guide\/(\w+)/);
    if (m) document.getElementById(`g-${m[1]}`)?.scrollIntoView();
  }, []);
  const go = (id: string) => {
    document.getElementById(`g-${id}`)?.scrollIntoView({ behavior: "smooth" });
    history.replaceState(null, "", `#guide/${id}`);
  };
  const ships = Object.values(SHIP_TYPES).filter((t) => t.buyable);

  return (
    <div className="guide">
      <header className="topbar">
        <span className="brand">SECTOR TRADERS <em>EPOCH II</em></span>
        <span className="spacer" />
        <button className="link" onClick={onBack}>{backLabel}</button>
      </header>
      <div className="guide-body">
        <nav className="guide-toc">
          <h3>How to play</h3>
          {SECTIONS.map((s) => <button key={s.id} className="link" onClick={() => go(s.id)}>{s.title}</button>)}
        </nav>
        <article className="guide-content">
          <h1>How to play</h1>
          <p className="lead">
            You're an independent pilot in a galaxy of linked sectors. Buy cheap, sell dear, and turn the profit into a
            better ship, planets of your own, a corporation, or a fleet of fighters. Everyone plays in the same galaxy at
            the same time, and everyone gets the same number of turns each day.
          </p>
          <p className="muted small">
            Numbers in this guide are the defaults. Your galaxy's admin can change most of them, so prices and limits in
            your game may differ.
          </p>

          <Section id="start">
            <p>Create an account with a username (3–24 letters, numbers, <code>_</code> or <code>-</code>) and a password of at least 8 characters.</p>
            <Shot src="login.png" caption="Sign in, or switch to Create account." />
            <p>
              The lobby lists the galaxies on this server. Type a trader name and press <b>Join</b>. Your trader name is
              how everyone else sees you, and it's unique in that galaxy. You can fly one pilot per galaxy; once you've
              joined, the button becomes <b>Play as …</b>.
            </p>
            <Shot src="lobby.png" caption="The lobby. Admins also see Settings links and the Create a galaxy box." />
            <p>
              You start in <b>sector 1</b>, home of {PLACE.homeWorld} and the {PLACE.depots[0]}, in
              a {SHIP_TYPES[S.startingShip]!.name} with {n(S.startingCredits)} credits, {S.startingHolds} cargo
              holds, {S.startingFighters} fighters and {n(S.turnsPerDay)} turns.
            </p>
          </Section>

          <Section id="screen">
            <Shot src="overview.png" caption="The game screen." />
            <ol className="callouts">
              <li><b>Top bar:</b> your rank and name, sector, turns left today, credits, holds used, fighters and shields.</li>
              <li><b>Sector view / Galaxy map:</b> switch between the picture of where you are and the map of what you've explored.</li>
              <li><b>The sector:</b> your ship, any port, planets, and other ships here, with their names.</li>
              <li><b>Navigation:</b> the sector's number and port, <b>Warp to</b> buttons for each exit, and <b>Plot course</b>.</li>
              <li><b>Sector actions:</b> everything you can do here: deploy fighters and mines, land on planets, use equipment, deal with other ships.</li>
              <li><b>Side tabs:</b> Port, Planet (when you've landed), Ship, Corp and Log. The Log tab shows a count of unread lines.</li>
              <li><b>Side panel:</b> the open tab. Here, a port's trading table.</li>
            </ol>
            <p>The screen updates live: when someone arrives or leaves your sector, attacks you, or messages you, you'll see it without refreshing.</p>
          </Section>

          <Section id="turns">
            <p>You get <b>{n(S.turnsPerDay)} turns a day</b>. Unused turns don't carry over. At the <b>daily reset</b> (midnight on the server by default):</p>
            <ul>
              <li>Everyone's turns go back to {n(S.turnsPerDay)}.</li>
              <li>Ports restock {pct(S.portRegenPct)} of their capacity.</li>
              <li>Planets produce goods and fighters, and planet treasuries earn {pct(S.treasuryInterestPct)} interest.</li>
              <li>Good pilots with more than {n(S.taxThreshold)} credits on hand pay {pct(S.taxPct)} in tax (see <a onClick={() => go("ranks")}>alignment</a>).</li>
              <li>Pilots nobody has seen for {S.inactiveDays} days are removed from the galaxy.</li>
            </ul>
            <table className="guide-table">
              <thead><tr><th>Costs turns</th><th>Free</th></tr></thead>
              <tbody><tr>
                <td>A warp jump (your ship's turns per jump, {SHIP_TYPES[S.startingShip]!.turnsPerWarp} for a {SHIP_TYPES[S.startingShip]!.name})<br />Docking at a port: {S.portDockTurns}<br />Landing on a planet: {S.landTurns}<br />Any attack: {S.attackTurns}<br />Holo scan, Genesis torpedo, TransWarp jump: 1 each<br />Each steal or rob attempt: {S.crimeTurns}</td>
                <td>Asking prices and haggling<br />Buying anything<br />Deploying fighters and laying mines<br />Planet management and citadel building<br />Plotting courses, the map, messages<br />Loading colonists</td>
              </tr></tbody>
            </table>
          </Section>

          <Section id="moving">
            <p>
              Sectors are joined by <b>warps</b>. Press a <b>Warp to</b> button to jump to a neighbour. Most warps go both
              ways, but a few are one-way, so the way back may be longer.
            </p>
            <p>
              To go further, type a sector number in <b>Plot course</b>. You'll see the shortest route and what it costs in
              turns; press <b>Engage autopilot</b> to fly it. The autopilot stops early if you run low on turns, get
              blocked, or arrive somewhere dangerous (enemy fighters, a fortified enemy planet, or a hostile ship).
            </p>
            <Shot src="map.png" caption="The galaxy map shows sectors you've visited (with port classes) and their neighbours. Scroll to zoom, drag to pan, click a sector to plot a course." />
            <h3>Bookmarks</h3>
            <p>
              Give any sector a name of your own in the <b>Bookmark</b> row of the sector panel — "Main planet", "Cheap ore",
              "Tavern" — and it appears in the <b>Bookmarks</b> bar under Plot course, where one press plots a route back to
              it. Names are yours alone; nobody else sees them, and you can keep {n(S.maxBookmarks)} of them.
            </p>
            <h3>Core Space</h3>
            <p>
              Sectors 1–{S.fedspaceSectors} (plus {PLACE.keystone}) are <b>{PLACE.core}</b>, policed by the Sector Authority.
              Nobody can deploy fighters, mines or beacons there. New pilots are <b>protected</b>: other players can't
              attack you in Core Space while your alignment is 0 or higher, you have under {n(S.fedMaxXp)} experience and you
              carry under {S.fedMaxFighters} fighters.
            </p>
            <h3>Getting blocked</h3>
            <p>
              Another pilot's fighters in a sector stop you leaving by any warp except the one you came in by. You can
              fight through them, go back the way you came, or, if they're toll fighters, pay the toll
              ({S.tollPerFighter} credits per fighter).
            </p>
            <Shot src="sector.png" caption="Blocked by toll fighters, with a Maw raider and another trader in the sector." />
          </Section>

          <Section id="trading">
            <p>
              There are three commodities: <b><Icon item="ore" /> Fuel Ore</b>, <b><Icon item="org" /> Organics</b> and
              <b> <Icon item="equ" /> Equipment</b> (base prices {S.commodityBasePrice.ore}, {S.commodityBasePrice.org} and {S.commodityBasePrice.equ}).
              Every trading port buys some and sells the others. Its class tells you which, in the order Ore, Organics,
              Equipment: <b>B</b> means the port buys from you, <b>S</b> means it sells to you.
            </p>
            <table className="guide-table">
              <thead><tr><th>Class</th><th>Pattern</th><th>What it does</th></tr></thead>
              <tbody>{PORT_ROWS.map(([c, p, d]) => <tr key={c}><td>{c}</td><td><code>{p}</code></td><td>{d}</td></tr>)}</tbody>
            </table>
            <p>
              Dock at the port (Port tab, {S.portDockTurns} turn), enter a quantity and press <b>Buy</b> or <b>Sell</b>.
              Prices move with stock: a port that's nearly sold out charges more, and a port that badly wants something
              pays more for it. Big loads move the price against you as you trade.
            </p>
            <Shot src="port.png" caption="A class 3 port: it sells Fuel Ore and buys Organics and Equipment." narrow />
            <p>
              The classic money-maker is a <b>trade pair</b>: two neighbouring ports where each sells what the other buys.
              Fill up at one, sell at the other, fill up with its goods, and fly back. Equipment is worth the most per hold.
            </p>
            <p>
              Anyone can pay to <b>upgrade</b> a port's capacity ({S.portUpgradeCostPerUnit} credits per unit, up to {n(S.portMaxCapacity)}).
              Bigger ports restock more each day, and you earn alignment for it.
            </p>
          </Section>

          <Section id="haggling">
            <p>When you press Buy or Sell, the port quotes a price for the whole load. You can accept it, or haggle.</p>
            <Shot src="haggle.png" caption="The port's offer. Type your own price and press Counter-offer, or accept." narrow />
            <ul>
              <li>Every port has a hidden best price, a few percent better than its quote ({pct(S.haggleRoomMin)} at first, rising to {pct(S.haggleRoomMax)} as you gain experience).</li>
              <li>Offer anything up to that best price and the port accepts, and you earn up to {S.haggleMaxXp} experience for how close you got.</li>
              <li>Push past it and the port counters with a new price. Push too hard {S.haggleMaxRounds} times and it walks away ("We're done here").</li>
              <li>Haggling costs no turns. Leaving the sector ends the negotiation.</li>
            </ul>
          </Section>

          <Section id="ships">
            <Shot src="ship.png" caption="The Ship tab: your hull, cargo, fighters and shields, rank, equipment and limpet tracking." narrow />
            <p>
              Each hull has a maximum number of holds, fighters and shields; you buy those separately. <b>Odds</b> are how
              hard each fighter hits (attack) and holds (defense). New ships are sold at Keystone Station's shipyard. Your
              old ship is taken in trade for {pct(S.shipTradeInPct)} of its price; fighters, shields, holds and equipment
              move to the new hull up to its limits.
            </p>
            <table className="guide-table">
              <thead><tr><th /><th>Ship</th><th>Price</th><th>Holds</th><th>Fighters</th><th>Shields</th><th>Turns/jump</th><th>Odds</th><th>Notes</th></tr></thead>
              <tbody>
                {ships.map((t) => (
                  <tr key={t.id}>
                    <td>{t.sprite && <img className="guide-ship" src={`/sprites/${t.sprite}.png`} alt="" />}</td>
                    <td><b>{t.name}</b></td>
                    <td>{n(S.shipPrices[t.id] ?? 0)}</td>
                    <td>{t.maxHolds}</td>
                    <td>{n(t.maxFighters)}</td>
                    <td>{n(t.maxShields)}</td>
                    <td>{t.turnsPerWarp}</td>
                    <td>{t.offensiveOdds}{t.defensiveOdds !== t.offensiveOdds ? ` / ${t.defensiveOdds}` : ""}</td>
                    <td className="small">
                      {[t.transwarp && "Takes a TransWarp drive", t.requires === "commission" && "Needs an Authority commission", t.requires === "corporation" && "Corporation CEOs only"].filter(Boolean).join(". ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Shot src="shipyard.png" caption="The shipyard at Keystone Station shows your trade-in and what each ship costs you." narrow />
            <h3>Losing your ship</h3>
            <p>
              If your ship is destroyed you eject in an <b>escape pod</b> to a neighbouring sector. You keep your credits,
              experience and alignment, but lose your cargo, fighters, shields, holds, mines, torpedoes and equipment. Head
              to Keystone Station for a new ship; if you can't afford the cheapest, they'll give you
              a {SHIP_TYPES[S.startingShip]!.name}. Lose the pod too and you're sent back to sector 1 in a
              new {SHIP_TYPES[S.startingShip]!.name} with no turns until the next reset.
            </p>
          </Section>

          <Section id="keystone">
            <p>
              <b>Keystone Station</b> is the big shipyard and trading hall, in Core Space. It doesn't trade commodities, but it
              sells everything else: ships, hardware and equipment. It also has the tavern and the Authority office. The
              three <b>depots</b> ({PLACE.depots[0]} in sector 1, {PLACE.depots[1]} and {PLACE.depots[2]}) sell
              fighters, shields and holds only.
            </p>
            <Shot src="hardware.png" caption="Hardware. Holds get a little dearer with each one you own." narrow />
            <table className="guide-table">
              <thead><tr><th>Item</th><th>Price</th><th>Limit</th></tr></thead>
              <tbody>
                <tr><td><Icon item="fighters" /> Fighters</td><td>{n(S.fighterPrice)}</td><td>Your ship's max</td></tr>
                <tr><td><Icon item="shields" /> Shields</td><td>{n(S.shieldPrice)} per point</td><td>Your ship's max</td></tr>
                <tr><td><Icon item="holds" /> Cargo holds</td><td>{n(S.holdPriceBase)} + {S.holdPriceStep} per hold you own</td><td>Your ship's max</td></tr>
                <tr><td><Icon item="armid" /> Burst mines (Keystone only)</td><td>{n(S.armidPrice)}</td><td>Carry {S.maxMinesCarried}</td></tr>
                <tr><td><Icon item="limpet" /> Limpet mines (Keystone only)</td><td>{n(S.limpetPrice)}</td><td>Carry {S.maxMinesCarried}</td></tr>
                <tr><td><Icon item="genesis" /> Genesis torpedoes (Keystone only)</td><td>{n(S.genesisPrice)}</td><td>Carry {S.maxGenesisCarried}</td></tr>
                <tr><td>Limpet removal</td><td>{n(S.limpetRemovalPrice)}</td><td>Clears every limpet on your hull</td></tr>
              </tbody>
            </table>
            <h3>The Authority office</h3>
            <p>
              With alignment of {n(S.commissionAlignment)} or more you can request a <b>commission</b>, which raises your
              alignment to {n(S.commissionGrant)} and lets you buy the Warden. Anyone can post a <b>bounty</b> (at
              least {n(S.bountyMin)} credits) on an evil pilot; whoever destroys that pilot collects it, and posting earns you
              alignment. The office also shows the Most Wanted list.
            </p>
            <h3>The hardship fund</h3>
            <p>
              Spent everything and have nothing left to sell? Dock at Keystone Station and the Authority office will stake
              you {n(S.reliefGrant)} credits, once a game day. It's a last resort, so the clerk turns you away if you still
              have cargo in your holds, a planet of your own, credits of {n(S.reliefGrant)} or more, or a corporation with a
              treasury to draw on. No trader need ever be stranded for good.
            </p>
          </Section>

          <Section id="equipment">
            <p>Equipment is sold only at Keystone Station. Installed items are bought once; the rest are used up one at a time. You lose it all with your ship.</p>
            <table className="guide-table">
              <thead><tr><th>Item</th><th>Price</th><th>What it does</th></tr></thead>
              <tbody>
                {GEAR.map((g) => (
                  <tr key={g.id}>
                    <td><span className="with-icon"><Icon item={g.id} />{g.label}</span></td>
                    <td>{n(S[g.price] as number)}{g.kind === "count" && g.max ? <span className="muted small"> (carry {n(S[g.max] as number)})</span> : <span className="muted small"> (installed)</span>}</td>
                    <td>{g.blurb}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              Equipment you own shows up as buttons under <b>Equipment</b> in the sector actions. A few details:
              the TransWarp drive fits only the Magnate, Warden and Hellion and burns {S.transwarpOrePerSector} Fuel Ore
              per sector of distance; photon missiles last {Math.round(S.photonSeconds / 60)} minutes and can't be fired in
              or out of Core Space; a cloak ends as soon as you move, dock, land or attack.
            </p>
          </Section>

          <Section id="combat">
            <p>
              To attack a ship, choose how many fighters to send and press <b>Attack</b> ({S.attackTurns} turn). Combat has
              no dice: each side's fighters are multiplied by its ship's odds, and the bigger number wins. The loser's
              fighters are wiped out; the winner loses fighters in proportion. Leftover attackers then hit shields (each
              shield point stops {S.shieldOdds} fighters), and if the shields run out, the ship is destroyed.
            </p>
            <ul>
              <li>You can't attack corpmates, Authority captains, protected pilots in Core Space, or the Maw's Warlord while his fighter screen stands.</li>
              <li>Destroying a ship earns {S.killXpBase} experience plus a share of the victim's. Killing a good pilot costs {S.killAlignment} alignment; killing an evil one earns it.</li>
              <li>You collect any bounty on a pilot you destroy, and all the credits an NPC ship was carrying.</li>
              <li>Attacking enemy fighters in a sector works the same way, against odds of 1 and no shields.</li>
            </ul>
          </Section>

          <Section id="deploy">
            <p>Outside Core Space you can leave fighters and mines behind. Deploying is free.</p>
            <ul>
              <li><b>Defensive fighters</b> stop other pilots leaving the sector except the way they came.</li>
              <li><b>Offensive fighters</b> also attack anyone who arrives, and can destroy escape pods.</li>
              <li><b>Toll fighters</b> let pilots through if they pay {S.tollPerFighter} credits per fighter, which goes to you.</li>
              <li>One stack per sector. You and your corpmates can add to it or take fighters back.</li>
              <li><b><Icon item="armid" /> Burst mines</b>: each has a {pct(S.armidTriggerChance)} chance to go off when an enemy arrives, for {S.armidDamage} damage to shields and then fighters. By default they can't destroy a hull.</li>
              <li><b><Icon item="limpet" /> Limpet mines</b> stick to an arriving enemy. Your Ship tab then tracks where that pilot is, until they pay to have it removed or lose their ship.</li>
            </ul>
          </Section>

          <Section id="ranks">
            <p>
              <b>Experience</b> comes from haggling well, destroying ships and successful crime. Every time your experience
              doubles you move up a rank. <b>Alignment</b> decides which set of titles you wear: 0 and up is good, below 0
              is evil.
            </p>
            <table className="guide-table ranks">
              <thead><tr><th>Experience</th><th>Good</th><th>Evil</th></tr></thead>
              <tbody>
                {GOOD_TITLES.map((g, i) => <tr key={g}><td>{n(i === 0 ? 0 : 2 ** i)}</td><td>{g}</td><td>{EVIL_TITLES[i]}</td></tr>)}
              </tbody>
            </table>
            <ul>
              <li><b>Raises alignment:</b> destroying evil pilots, posting bounties, upgrading ports, paying taxes, a commission.</li>
              <li><b>Lowers alignment:</b> destroying good pilots, stealing and robbing, detonating a planet.</li>
              <li><b>Taxes:</b> at each reset, good pilots carrying more than {n(S.taxThreshold)} credits pay {pct(S.taxPct)}, and gain 1 alignment per {n(S.taxCreditsPerAlignment)} paid. Money in planet and corporate treasuries isn't taxed.</li>
              <li>Evil pilots ({S.authorityHostileAlignment} or lower) are hunted by Authority captains in Core Space.</li>
            </ul>
          </Section>

          <Section id="crime">
            <p>
              Pilots with alignment {S.thiefAlignment} or lower can use the <b>Back-room business</b> section of a port's
              panel to <b>steal</b> goods the port sells or <b>rob</b> its till. How much you can take grows with your
              experience. Each attempt costs {S.crimeTurns} turn and some alignment.
            </p>
            <ul>
              <li>The chance of getting caught starts at {pct(S.crimeBustBase)} and rises {pct(S.crimeBustHeat)} with each attempt at that port today, and a little more the greedier you are.</li>
              <li>Get caught and you lose {pct(S.bustHoldsLossPct)} of your holds and {pct(S.bustXpLossPct)} of your experience, and that port won't deal with you for {S.bustDays} days.</li>
            </ul>
          </Section>

          <Section id="planets">
            <p>
              Launch a <b><Icon item="genesis" /> Genesis torpedo</b> outside Core Space to create a planet (up
              to {S.maxPlanetsPerSector} per sector). You can also claim one of the unowned planets scattered around the
              galaxy just by landing on it. Planets are built by colonists: pick them up free in <b>sector 1</b> from
              {" "}{PLACE.homeWorld} (one per cargo hold), fly them home, land, and put them to work.
            </p>
            <Shot src="planet.png" caption="The Planet tab: colonists and what they make, storage, citadel, treasury and defenses." narrow />
            <table className="guide-table">
              <thead><tr><th>Class</th><th>Colonists per unit per day<br /><span className="muted small">Ore / Organics / Equipment (lower is better)</span></th><th>Max colonists</th></tr></thead>
              <tbody>
                {(Object.keys(PLANET_CLASSES) as PlanetClassId[]).map((k) => {
                  const c = PLANET_CLASSES[k];
                  const r = (x: number | null) => x == null ? "—" : n(x);
                  return (
                    <tr key={k}>
                      <td><span className="with-icon"><img className="guide-planet" src={`/sprites/${c.sprite}.png`} alt="" /><b>{k}</b> {c.name}</span></td>
                      <td>{r(c.ratio.ore)} / {r(c.ratio.org)} / {r(c.ratio.equ)}</td>
                      <td>{n(c.maxColonists)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <ul>
              <li>Each job makes (colonists in that job ÷ the class's figure) units a day, and the planet also builds fighters from its output.</li>
              <li>Output peaks at half the planet's maximum colonists; crowding it further makes less, not more.</li>
              <li>Move goods and fighters between your ship and the planet freely in the Storage section.</li>
              <li>If an enemy planet has no fighters and no shields, landing on it takes it. Otherwise you have to attack it.</li>
            </ul>
          </Section>

          <Section id="citadels">
            <p>
              A citadel turns a planet into a fortress. Build it one level at a time: each level needs a number of
              colonists living on the planet, spends Fuel Ore, Organics and Equipment from the planet's stock, and takes
              some days (daily resets) to finish.
            </p>
            <table className="guide-table">
              <thead><tr><th>Level</th><th>Adds</th><th>Class M cost <span className="muted small">(colonists; ore / org / equ; days)</span></th></tr></thead>
              <tbody>
                {CITADEL_LEVELS.map((l) => {
                  const c = citadelCost("M", l.level);
                  return <tr key={l.level}><td>{l.level}. {l.name}</td><td>{l.adds}</td><td>{n(c.colonists)}; {n(c.ore)} / {n(c.org)} / {n(c.equ)}; {c.days}</td></tr>;
                })}
              </tbody>
            </table>
            <ul>
              <li><b>Treasury:</b> park credits on the planet, safe from tax, earning {pct(S.treasuryInterestPct)} a day.</li>
              <li><b>Military reaction:</b> a share of the planet's fighters attacks enemies who enter the sector.</li>
              <li><b>Quasar Cannon:</b> burns the planet's Fuel Ore to shoot at ships entering the sector (sector %) and at anyone attacking the planet (atmospheric %).</li>
              <li><b>Planetary TransWarp:</b> move the whole planet, for {S.planetWarpOrePerSector} Fuel Ore per sector.</li>
              <li><b>Planetary shields:</b> convert your ship's shields {S.planetShieldConversion}:1; each planetary shield point stops {S.planetShieldOdds} attacking fighters.</li>
              <li><b>Interdictor:</b> holds enemy ships in the sector, burning {S.interdictorOre} Fuel Ore each time.</li>
            </ul>
            <p>
              Attacking a planet: its atmospheric cannon fires first, then your fighters must break its shields and beat
              its fighters. Win, and the planet is yours with everything on it. A photon missile knocks out a weakly
              shielded planet's cannon and interdictor for a few minutes.
            </p>
          </Section>

          <Section id="corps">
            <p>
              A corporation is a team of up to {S.maxCorpMembers} pilots. Found one for free on the Corp tab; you become its
              CEO and can invite others by trader name.
            </p>
            <Shot src="corp.png" caption="The Corp tab, with the emblem, treasury, memo, corp channel and members." narrow />
            <ul>
              <li>Corpmates share planets, and their fighters, mines and planet defenses never touch each other.</li>
              <li>Anyone can deposit into the treasury; only the CEO can withdraw.</li>
              <li>The CEO invites and expels members, writes the memo, picks the corporation's emblem, and can hand over the job or disband.</li>
              <li>Only a CEO can buy the Magnate, the corporate flagship.</li>
              <li>Your corp's emblem shows beside your members' names and on your planets.</li>
            </ul>
          </Section>

          <Section id="talk">
            <p>Everything that happens to you goes into your <b>Log</b>, including while you're offline, so you'll see it next time you play.</p>
            <Shot src="log.png" caption="The Log: send messages, and filter by messages, combat, or trade and planets." narrow />
            <ul>
              <li><b>Direct message</b> any pilot by name. <b>Sector radio</b> reaches everyone in your sector. The <b>Authority channel</b> reaches the whole galaxy. Corp members also get a corp channel.</li>
              <li><b>Marker beacons</b> leave a message in a sector for anyone who arrives.</li>
            </ul>
            <Shot src="tavern.png" caption="The tavern at Keystone Station." narrow />
            <p>
              The <b>tavern</b> at Keystone Station has a notice board ({n(S.tavernPostPrice)} credits to pin a notice), and a
              keeper who'll sell you a true rumor ({n(S.tavernRumorPrice)}) or tell you where a pilot was last
              seen ({n(S.tavernTracePrice)}).
            </p>
          </Section>

          <Section id="npcs">
            {(["authority", "maw", "vey"] as const).map((f) => (
              <div key={f} className="guide-faction">
                <img src={`/sprites/${FACTIONS[f].emblem}.png`} alt="" />
                <div>
                  <h3>{FACTIONS[f].name}</h3>
                  {f === "authority" && <p>Four captains patrol Core Space. They can't be attacked or destroyed, and they attack any pilot there with alignment of {S.authorityHostileAlignment} or lower.</p>}
                  {f === "maw" && <p>Raiders operating from a hidden home base far from Core Space. They attack pilots they think they can beat and take {pct(S.mawLootPct)} of their credits, but by default they leave protected new pilots alone. Find their base, break the fighter screen, and destroy Warlord Skarn to crack his vault. The tavern keeper sometimes knows where they've been.</p>}
                  {f === "vey" && <p>Wandering alien traders, found anywhere including Core Space. Most just trade, but about {pct(S.veyEvilPct)} have turned raider. Each carries credits that go to whoever destroys it.</p>}
                </div>
              </div>
            ))}
          </Section>

          <Section id="tips">
            <ol>
              <li>Find a trade pair near sector 1 on the galaxy map and run it until your turns are low. Buy more holds as soon as you can afford them.</li>
              <li>Haggle every trade a little. It's free, it saves credits, and the experience adds up.</li>
              <li>Stay in Core Space while you're small. Once you pass {n(S.fedMaxXp)} experience or {S.fedMaxFighters} fighters, you're fair game.</li>
              <li>Carry fighters and shields before you roam: the Maw and hostile Vey pick on weak ships.</li>
              <li>Credits on hand are taxed and can be stolen. Park savings in a planet treasury once you have a citadel.</li>
              <li>A planet with good colonists is a money machine. Put colonists where the class is efficient, and keep the population at about half the maximum.</li>
              <li>Join or found a corporation. Shared planets and fighter networks are much harder to break than a lone pilot.</li>
              <li>Check your Log after being away: attacks, trades and messages all wait for you there.</li>
            </ol>
          </Section>
        </article>
      </div>
    </div>
  );
}
