# Changelog

All notable changes to Sector Traders: Epoch II, newest first.

**Versioning.** The project has one version number, in the root `package.json`. It's
[semver](https://semver.org): given `MAJOR.MINOR.PATCH`, a **minor** bump means new features or a new
database migration, a **patch** bump means fixes only, and a **major** bump would mean an upgrade
that can't carry an existing galaxy forward. The packages under `packages/` and `apps/` are private,
are never published to npm, and refer to each other as `*`, so their own `version` fields aren't
maintained — ignore them.

Entries marked **Migration** change the database. Migrations run by themselves when `app` and
`worker` start, they're forward-only, and so far they only add tables and columns, so accounts and
galaxies carry over. Back up before upgrading anyway: see
[Upgrading](README.md#upgrading).

## 0.2.0 — 2026-09-30

A pilot who spent their last credit used to have no way out, and no way to leave a galaxy they were
done with. Both are fixed, and sectors you care about can now be given names.

### Added

- **The Authority hardship fund.** Dock at Keystone Station with nothing left and the Authority
  office will stake you credits to get trading again — once a game day. It's a last resort, so the
  clerk turns you away if you still have cargo in your holds, a planet of your own, credits at or
  above the payout, or a corporation with a treasury to draw on. Admins can change the payout or
  switch the fund off entirely.
- **Leaving a galaxy.** A **Leave galaxy** button on each galaxy in the lobby, behind a confirmation
  that makes you type your trader name. It deletes that trader for good: ship, credits, holds,
  fighters, mines, beacons, limpets, bookmarks, notices and log. Planets pass to a corpmate if you
  have one, or become unclaimed; a departing CEO hands the chair to the most recently active member;
  bounties posted on you are refunded to whoever posted them. Your account and your other galaxies
  are untouched, and you can join the same galaxy again later as a brand new trader.
- **Named sector bookmarks.** Name the sector you're in from the sector panel — "Main planet",
  "Cheap ore", "Tavern" — and it appears in a **Bookmarks** bar under *Plot course*, where one press
  plots a route back to it. Names are private to each trader. Renaming and removing are free and
  cost no turns.

### Changed

- Removing a trader from a galaxy is now one piece of code, shared by voluntary leaving and by the
  daily prune of traders nobody has seen in `inactiveDays`. Pruning behaves as it always did; it just
  no longer has its own copy of the CEO handover, planet inheritance and bounty refunds.
- The in-game guide covers bookmarks (under *Moving around*) and the hardship fund (under *Keystone
  Station and the depots*). The Ship panel points at both.

### Settings

Three new settings, all with defaults, so existing galaxies pick them up on restart with no action
needed. Worth a look on the admin settings page if you want to tune them:

| Setting | Default | What it does |
| --- | --- | --- |
| `maxBookmarks` | 50 | Named sectors each trader can keep. Lowering it removes nothing; traders just can't add more. |
| `reliefEnabled` | on | Whether the hardship fund exists at all. Off means a ruined trader has no way back. |
| `reliefGrant` | 5,000 | Credits the fund pays out, at most once a game day. |

### Migration

`0010_bookmarks_and_relief` — adds the `bookmarks` table and a `players.last_relief_at` column.

## 0.1.0 — 2026-09-30

First public release, on GitHub under the MIT license. The game as it stood at import: a web-based,
multiplayer space-trading game in the spirit of TradeWars 2002 v3, self-hosted as a small Docker
stack.

- Seeded galaxy generation: warp network, trading ports, Core Space, Keystone Station and the
  hardware depots.
- Trading and haggling against port stock and prices that move as people trade.
- Ships and the shipyard, cargo holds, fighters, shields, equipment, escape pods.
- Combat between traders, deployed fighter stacks with defensive, toll and offensive modes, burst and
  limpet mines.
- Planets, colonists, citadels, planetary defenses and Q-cannons, Genesis torpedoes.
- Corporations with a shared treasury, invites, a memo board and emblems.
- Crime: stealing from and robbing ports, with busts and bans.
- NPC factions with their own behaviour, the tavern, the Authority office, bounties and commissions.
- Realtime sector and message updates, a daily reset, turn budgets, and an in-game "How to play"
  guide generated from the game's own data.
- Per-galaxy admin settings for most numbers in the game.
