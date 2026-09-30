# Sector Traders: Epoch II

A web-based, multiplayer space-trading game in the spirit of TradeWars 2002 v3. New name, new art, new text; the gameplay loop is the one you remember. It runs as a small Docker stack that you host yourself.

![The game screen](apps/web/public/guide/overview.png)

This README covers **setting up and running a server**. For how to play, open the game and click **How to play** (it's on the sign-in page, in the lobby, and in the game's top bar), or go to `http://<your server>/#guide`.

## Contents

1. [What you need](#what-you-need)
2. [Install](#install)
3. [First sign-in and your first galaxy](#first-sign-in-and-your-first-galaxy)
4. [Changing game settings](#changing-game-settings)
5. [Inviting players](#inviting-players)
6. [Serving it over HTTPS](#serving-it-over-https)
7. [Upgrading](#upgrading)
8. [What's safe to restart or rebuild](#whats-safe-to-restart-or-rebuild)
9. [Back up and restore](#back-up-and-restore)
10. [Admin tasks](#admin-tasks)
11. [Troubleshooting](#troubleshooting)
12. [Development](#development)
13. [License](#license)

## What you need

- A Linux host (or anything else that runs Docker) with **Docker and Docker Compose v2** (`docker compose`, not the old `docker-compose`).
- One free TCP port for the web server (3000 by default).
- Git, to fetch the code.

The stack builds its own images from this repo; nothing is pulled from a registry except the base `node` and `postgres` images.

## Install

**1. Get the code.**

```bash
git clone https://github.com/Sc00tz/sectortraders-epochii.git sectortraders
cd sectortraders
```

**2. Create your `.env` file** from the example and set a real database password.

```bash
cp .env.example .env
nano .env
```

| Setting | Default | What it does |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | `change-me` | Password for the game's database. **Required**; the stack won't start without it. Set it before the first start: Postgres only reads it when the database is first created. |
| `POSTGRES_USER` | `sectortraders` | Database user. |
| `POSTGRES_DB` | `sectortraders` | Database name. |
| `ST_PORT` | `3000` | Port on the host that the game is published on. |
| `TZ` | `America/New_York` | Time zone for the daily reset. |
| `RESET_CRON` | `0 0 * * *` | When the daily reset runs, as a cron schedule in `TZ` (default: midnight). |
| `SECURE_COOKIES` | `false` | Set to `true` once players reach the game over HTTPS. Leave it `false` for plain HTTP, or sign-in won't stick. |
| `LOG_LEVEL` | `info` | Server log level (`debug`, `info`, `warn`, `error`). Not in `.env.example`; add it if you need it. |

**3. Build and start.**

```bash
docker compose up -d --build
```

The first build takes a few minutes. When it's done, check that all three containers are up and the app is healthy:

```bash
docker compose ps
curl http://localhost:3000/healthz     # {"ok":true}
```

**4. Open the game** at `http://<host>:3000` (or the `ST_PORT` you chose).

### What runs

| Container | Holds game data? | What it does |
| --- | --- | --- |
| `postgres` | **Yes**, in the `pgdata` volume | All accounts, galaxies, players, ports |
| `app` | No | Web client, API, live updates (Socket.IO) on port 3000 |
| `worker` | No | The daily reset at `RESET_CRON` in `TZ` (refills turns, restocks ports, planet production, taxes, inactive-player cleanup, NPC restock), and an NPC turn once a minute |

Database migrations run automatically when `app` or `worker` starts, under a lock so the two don't collide.

## First sign-in and your first galaxy

**The first account created on a fresh install becomes the admin.** Create yours before you tell anyone else about the server.

![Sign in](apps/web/public/guide/login.png)

Click **New here? Create an account**. Usernames are 3–24 letters, numbers, `_` or `-`; passwords need at least 8 characters.

In the lobby, the admin sees a **Create a galaxy** box. Give the galaxy a name, pick a size (500, 1,000, 2,000, 5,000 or 10,000 sectors) and click **Create**. Creating a galaxy (the "Big Bang") takes a few seconds.

![The lobby](apps/web/public/guide/lobby.png)

- **All settings…** opens every game option before you create, including the ones that are fixed once a galaxy exists (size, Core Space size, warp and port density, starting planets, and the random seed).
- You can run several galaxies on one server. Each one keeps its own copy of the rules.
- To play, type a trader name next to the galaxy and click **Join**. The admin plays like everyone else.

## Changing game settings

Click **Settings** next to a galaxy in the lobby (admins only).

![Admin settings](apps/web/public/guide/admin.png)

- Settings are grouped (turns and new players, ports and prices, haggling, hardware, shipyard, combat, planets, corporations, equipment, crime and taxes, the Authority office, the tavern, NPCs) and searchable. Each shows its default and allowed range.
- **Changes take effect as soon as you save.** Nothing restarts. A few say they apply at the next daily reset, or only to players who join afterwards.
- Galaxy-shape settings are read-only once the galaxy exists.
- **Remove inactive traders after (days)** (default 30) deletes pilots nobody has seen in that long, at the daily reset. Set it to 0 to keep everyone forever. Their planets pass to a corpmate or become unowned.
- **Run the daily reset now** runs the reset immediately, the same as the scheduled one.

Defaults live in `packages/shared/src/settings.ts`, and each setting's label, limits, and help text in `packages/shared/src/settingsMeta.ts`.

## Inviting players

Send people the address of your server. Anyone who can reach it can create an account; there's no invite list or closed sign-up yet, so if the server is on the internet, anyone who finds it can register and play. They create an account, pick a galaxy in the lobby, choose a trader name and join. Point them at **How to play** on the sign-in page.

## Serving it over HTTPS

Put the `app` container behind your reverse proxy, then:

1. Proxy everything to `http://<host>:<ST_PORT>`.
2. **Pass WebSocket upgrades** for `/socket.io`. Without them the game still loads, but live updates (other ships arriving, attacks, messages) don't arrive until a refresh.
3. Set `SECURE_COOKIES=true` in `.env` and run `docker compose up -d` to apply it.

For example, with nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

## Upgrading

```bash
cd sectortraders
docker compose exec -T postgres pg_dump -U sectortraders -Fc sectortraders > sectortraders-$(date +%F).dump   # back up first
git pull
docker compose up -d --build
```

What that does to a running game:

- `app` and `worker` are rebuilt and recreated. Players' browsers lose their connection for a few seconds and reconnect on their own. **Anyone in the middle of haggling loses that negotiation** and has to ask the port for a new price. Nothing else is lost.
- New database migrations run on start. So far they only add tables and columns, so accounts and galaxies carry over. [CHANGELOG.md](CHANGELOG.md) says which releases include a migration.
- New settings get their defaults in existing galaxies. Check the admin settings page after upgrading in case a new one needs tuning; [CHANGELOG.md](CHANGELOG.md) lists the new ones for each release.

## What's safe to restart or rebuild

- **`app` and `worker`**: stateless, so `docker compose up -d --build`, restarts, and recreates lose no game data.
  - Restarting `app` drops everyone's live connection for a few seconds (browsers reconnect on their own). It also cancels any haggle a player is in the middle of; they just ask the port for a new price.
  - If `worker` is down at reset time, it runs one catch-up reset when it comes back.
  - While `worker` is down, NPCs freeze in place. Nothing is lost; they pick up again when it's back.
- **`postgres`**: restarting it is safe (data lives in the volume). While it's down, the app returns errors.
- **Destructive**: `docker compose down -v` or deleting the `sectortraders_pgdata` volume **erases every account and galaxy**. Back it up first.

## Back up and restore

```bash
# backup
docker compose exec -T postgres pg_dump -U sectortraders -Fc sectortraders > sectortraders-$(date +%F).dump

# restore into a running stack (stop app/worker first so nobody is playing)
docker compose stop app worker
docker compose exec -T postgres pg_restore -U sectortraders -d sectortraders --clean --if-exists < sectortraders-YYYY-MM-DD.dump
docker compose start app worker
```

If you changed `POSTGRES_USER` or `POSTGRES_DB`, use your values in place of `sectortraders` after `-U` and `-d`.

## Admin tasks

**Make another account an admin** (they must have signed up already):

```bash
docker compose exec postgres psql -U sectortraders -d sectortraders \
  -c "update users set is_admin = true where lower(username) = lower('their-username');"
```

They'll see the admin controls the next time the lobby loads.

**Passwords:** there's no password reset yet. A player who forgets theirs has to make a new account.

**Watch the logs:**

```bash
docker compose logs -f app       # web server and API
docker compose logs -f worker    # daily reset and NPC turns
```

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `docker compose up` says `set POSTGRES_PASSWORD in .env` | There's no `.env`, or the password line is empty. |
| App keeps restarting; logs show a database authentication error | `POSTGRES_PASSWORD` was changed after the database was created. Put the old one back, or change the password inside Postgres to match. |
| Page won't load | Check `docker compose ps`, and that `ST_PORT` isn't used by something else on the host. |
| Signing in seems to work, then you're signed out again | `SECURE_COOKIES=true` while you're on plain HTTP. Set it to `false`, or use HTTPS. |
| The game loads but nothing updates live | Your proxy isn't passing WebSocket upgrades for `/socket.io`. |
| Turns didn't refill at midnight | Check `docker compose logs worker`, and that `TZ` and `RESET_CRON` are what you expect. The admin can run the reset by hand from the settings page. |
| NPCs aren't moving | `worker` is down, or NPCs are turned off in the galaxy's settings. |

## Development

Node 22+ and a Postgres you can reach.

```bash
npm install
export DATABASE_URL=postgres://user:pass@localhost:5432/sectortraders
npm run dev:server            # API + live updates on :3000 (runs migrations)
npm run dev:web               # Vite dev server on :5173, proxies /api and /socket.io
npm run dev:worker -w apps/server   # optional: daily reset job
npm test                      # unit tests (pricing, haggling, combat, planets, NPCs, settings, universe generator)
npm run typecheck
```

After changing `apps/server/src/db/schema.ts`, run `npm run db:generate` and commit the new file in `apps/server/drizzle/`.

The player guide is `apps/web/src/Guide.tsx`; its screenshots are in `apps/web/public/guide/`. Its tables (ships, equipment, ranks, planets, citadels) are built from the game's own data, so they stay current on their own, but the screenshots and prose need a refresh when the UI changes.

### Layout

```
packages/shared   game rules shared by server and browser: port classes, pricing, haggling, ship stats, settings
apps/server       Fastify API, Socket.IO, Drizzle (Postgres), pg-boss worker, universe generator
apps/web          React UI, PixiJS sector view and galaxy map, sprites in public/sprites, guide screenshots in public/guide
```

The design spec (rules, open questions, art prompts) lives in the project's Claude Docs spec, not in this repo.

## License

MIT — see [LICENSE](LICENSE). The sprite art and guide screenshots in `apps/web/public/` are covered by the same license.
