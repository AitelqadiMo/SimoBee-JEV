# SimoBee: run it locally on a Mac

This is a fork of [beebots](https://github.com/imikerussell/beebots) with three changes:

- **No OpenAI.** On Setup you design each bee yourself (name, tagline, trading style, coins, rules). Portraits are drawn
  locally. The only key you need is **Jev**.
- **Low-cost defaults.** Each bee asks Jev every **30 s** (`TICK_MS=30000`), and Jev spend is capped at **$0.50/day**
  (`JEV_DAILY_USD_CAP=0.5`). Roughly $0.30/day in practice.
- **Built from this repo.** `docker compose up -d --build` builds all three images from your checkout. Nothing is pulled
  from the original project. The Hive (public leaderboard) is off.

It trades **on paper**: real OKX prices, simulated money ($333 per bee). No exchange account is involved.
Not financial advice.

---

## 1. One-time prerequisites

| What | How |
|---|---|
| **Docker Desktop** | Download from docker.com/products/docker-desktop (pick Apple Silicon or Intel), install, open it, wait until it says *Engine running*. |
| **Git** | Run `git --version` in Terminal. If it's missing, macOS offers to install the Command Line Tools. Say yes. |
| **Jev key** | console.typesafe.ai → add a few dollars of credit → **Keys** → create a key. Keep it private; you'll paste it into the Setup page only. |
| **GitHub login for a private repo** | Easiest: `brew install gh && gh auth login` (or use GitHub Desktop). |

## 2. Get the code and start it

```sh
cd ~
git clone https://github.com/AitelqadiMo/SimoBee-JEV.git
cd SimoBee-JEV
bash scripts/mac-start.sh
```

`scripts/mac-start.sh` checks Docker is running, builds the images (the first build takes 3–6 minutes), starts everything and
opens http://localhost. Prefer doing it by hand? `docker compose up -d --build`, then open http://localhost.

> Port 80 already in use (another web server)? Create a file named `.env` in the folder containing
> `WEB_HTTP_PORT=8088`, run the script again, and open http://localhost:8088.

## 3. Setup page (http://localhost)

1. Tick the three risk statements.
2. Pick an **owner password** (8+ characters). Write it down.
3. Paste your **Jev key** → **Check key**. You should see ✓ *Jev answered*.
4. **Design your bees.** Three examples are pre-filled (Trend on BTC/ETH, Breakout on BTC/ETH/SOL, Momentum on any
   coin). Change anything you like, then press **Create my bee** on each. The engine checks the coins against OKX's
   live list and tells you if a style can't trade them.
5. **Start paper trading.** The engine restarts and the dashboard opens within about a minute.

The page on http://localhost shows a "plain HTTP" warning. On your own machine that's fine.

## 4. Check that Jev is really working

```sh
docker compose logs -f engine        # Ctrl+C to stop following
```

Healthy signs: `engine started (MODE=dry)`, then decisions every ~30 s per bee. On the dashboard each bee shows its
latest decision, and the header shows Jev spend for the day.

Quick health check: `curl -s localhost/health` should answer `{"ok":true,...}`.

Let it run for a few days. Things worth checking before we move on:

- Jev calls succeed (no repeated `jev` errors or "holding" because Jev was down)
- Jev spend per day stays under the cap
- Trades, fees and funding show up and make sense

## 5. Everyday commands (run inside the SimoBee-JEV folder)

| Task | Command |
|---|---|
| Stop | `docker compose stop` |
| Start again | `docker compose start` |
| Status | `docker compose ps` |
| Engine logs | `docker compose logs --tail 200 engine` |
| Get my latest changes | `git pull && docker compose up -d --build` |
| Redo Setup (new bees / key / password) | `docker compose exec engine rm /data/settings.json && docker compose restart engine` |
| Setup timed out (2 h window) | `docker compose restart engine` |
| Wipe everything (bees, history) | `docker compose down -v` |

Your bees, settings and history live in Docker volumes, so they survive restarts and rebuilds.

## 6. Tuning costs (optional)

Create or edit `.env` in the folder, then `docker compose up -d`:

```sh
TICK_MS=30000            # ms between decisions per bee. 60000 halves Jev cost, 10000 triples it
JEV_DAILY_USD_CAP=0.5    # hard daily cap; when hit, every bee holds until 00:00 UTC
```

Every other setting is in `.env.example`.

## 7. Running without Docker (optional)

Needs Node.js 22+ and pnpm (`brew install node pnpm`).

```sh
pnpm install
pnpm test                # 225 tests: risk layer, setup, ledger, indicators
pnpm dev                 # engine on http://127.0.0.1:8080 (Setup runs if there is no key)
cd dashboard && pnpm install && pnpm dev   # dashboard on http://127.0.0.1:5173
```

## What comes next

1. **Paper + real Jev on your Mac** ← you are here
2. **OKX demo mode**: 3 OKX sub-accounts with *demo* API keys (Read + Trade only), `MODE=demo`, `DRY_RUN=false`
3. **Hostinger VPS**: same repo, same `docker compose up -d --build`, plus a domain for HTTPS
4. **Real money**, only if the demo results justify it. See "Real money" in README.md.
