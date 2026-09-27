// First-run Setup. With no Jev key anywhere, the engine starts in setup mode: no trading, just the dashboard's Setup
// page. The page is public (a fresh VPS), and there is no code to dig out of a log, so it is protected by:
//  - first come, first served: once saved, Setup is closed for good (until the owner deletes settings.json);
//  - a setup window: SETUP_WINDOW_MIN after the engine starts (default 120), Setup locks until the container restarts;
//  - caps on outbound calls (key checks, coin-list lookups), in total and per visitor.
// The owner picks an owner password here; later writes from the public dashboard need it (gate.ts).
// After a save the engine exits and Docker restarts it with the new settings, in paper trading.
// SimoBee fork: no OpenAI. The owner designs each bee by hand (name, tagline, trading style, coins, rules); the engine
// checks the coins against OKX's live list, picks the brain that can trade them, and draws a portrait locally (SVG).
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { z } from "zod";
import { BEES } from "./config.js";
import { hashPassword, MAX_PASSWORD, MIN_PASSWORD, readJson, send } from "./gate.js";
import { checkJevKey } from "./jev.js";
import { log } from "./log.js";
import { BIZZY_BREAKOUT_COINS } from "./bees/bizzy.js";
import { BREEZY_COINS } from "./bees/breezy.js";
import { deriveStyle } from "./bees/custom.js";
import { fetchXperpCoins } from "./okx/public.js";
import { portraitSvg } from "./portrait.js";
import { safeError } from "./redact.js";
import { clientAddr } from "./visitors.js";
import { BeeSchema, isReservedName, saveSettings, STYLE_INFO, STYLES, type Settings, type StyleId } from "./settings.js";

const MAX_DESIGNS = 60;
/** Per visitor (client address): paid or outbound calls (designs, portraits, key checks). */
const MAX_CALLS_PER_ADDR = 40;
const COINS_TTL_MS = 10 * 60_000;
const MAX_BODY = 32 * 1024;

export interface SetupOpts {
  settingsPath: string;
  jevModel: string;
  /** Called after a successful save (the engine exits so Docker restarts it). */
  onSaved: () => void;
  /** OKX EEA public REST base, for the live coin list. */
  okxApiBase: string;
  /** Minutes after the engine starts that Setup stays open (SETUP_WINDOW_MIN). */
  windowMin: number;
  now?: () => number;
  /** Injectable for tests; defaults to one real Jev call. */
  checkJev?: (key: string, model: string) => Promise<string | null>;
  /** Injectable for tests; default: OKX's live crypto X-Perp list. */
  listCoins?: () => Promise<string[]>;
}

/** A bee as the owner designed it on the Setup page, after the engine has checked it. */
export interface BeeDesign {
  name: string;
  tagline: string;
  rules: string;
  coins: string[];
  baseStyle: StyleId;
  look: string;
  /** Set when the chosen style cannot trade these coins, so the bee runs on another one. */
  styleNote?: string;
}

export class DesignError extends Error {}

export const TIMED_OUT =
  "Setup timed out to keep this server safe. Restart the engine container (Hostinger Docker Manager → Restart, or `docker compose restart engine`) to open it again.";

const reservedMsg = (name: string) =>
  `"${name}" belongs to one of the official bees (${STYLES.map((s) => STYLE_INFO[s].name).join(", ")}). Pick another name.`;

/**
 * Checks a design from the model: coins must be on OKX's live list (unknown ones are dropped; if none are left, the
 * owner is asked to rephrase), the brain is forced to one that can trade those coins, reserved names are refused.
 */
export function finishDesign(raw: BeeDesign, known: string[]): BeeDesign {
  const name = raw.name.replace(/[^\p{L}\p{N} .'_-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 24);
  if (!name) throw new DesignError("Give your bee a name (letters, numbers, spaces and . ' _ -).");
  if (isReservedName(name)) throw new DesignError(reservedMsg(name));
  const set = new Set(known);
  const asked = [...new Set(raw.coins.map((c) => c.trim().toUpperCase().replace(/-.*$/, "")).filter(Boolean))];
  const coins = asked.filter((c) => set.has(c)).slice(0, 20);
  if (asked.length && !coins.length) {
    throw new DesignError(`${asked.slice(0, 5).join(", ")} ${asked.length > 1 ? "aren't" : "isn't"} tradable on OKX EEA right now. Try a coin like BTC, ETH, SOL or DOGE, or leave the coins empty for any coin.`);
  }
  const rules = raw.rules.replace(/\s+/g, " ").trim().slice(0, 500);
  if (rules.length < 10) throw new DesignError("Write this bee's rules in a sentence or two (at least 10 characters).");
  let tagline = raw.tagline.replace(/\s+/g, " ").trim().slice(0, 40);
  if (tagline && !/^the\b/i.test(tagline)) tagline = `the ${tagline}`.slice(0, 40);
  const baseStyle = deriveStyle(raw.baseStyle, coins);
  const look = (raw.look.replace(/\s+/g, " ").trim() || `a ${STYLE_INFO[baseStyle].label.toLowerCase()} bee`).slice(0, 400);
  const out: BeeDesign = { name, tagline, rules, coins, baseStyle, look };
  if (baseStyle !== raw.baseStyle) out.styleNote = styleNote(raw.baseStyle, baseStyle, coins);
  return out;
}

const STYLE_COINS: Partial<Record<BeeDesign["baseStyle"], readonly string[]>> = { bizzy: BIZZY_BREAKOUT_COINS, breezy: BREEZY_COINS };
const list = (xs: readonly string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : (xs[0] ?? ""));

/** Says out loud why a bee runs on a different brain than the one it was designed for (Setup used to switch silently). */
export function styleNote(wanted: BeeDesign["baseStyle"], got: BeeDesign["baseStyle"], coins: string[]): string {
  const only = STYLE_COINS[wanted] ?? [];
  const what = coins.length ? `with ${list(coins)}` : "on any coin";
  return `${STYLE_INFO[wanted].label} only trades ${list(only)}, so ${what} this bee runs on ${STYLE_INFO[got].label}.`;
}

export function imageDir(settingsPath: string): string {
  return join(dirname(settingsPath), "bee-images");
}

/** A bee's portrait file: the SVG drawn on Setup (this fork), or a JPEG from an older install. */
export function imagePath(settingsPath: string, slot: string): string | null {
  if (!(BEES as readonly string[]).includes(slot)) return null;
  for (const ext of ["svg", "jpg"]) {
    const p = join(imageDir(settingsPath), `${slot}.${ext}`);
    if (existsSync(p)) return p;
  }
  return null;
}

const Accept = z.object({ notAdvice: z.literal(true), paperDefault: z.literal(true), ownRisk: z.literal(true) });
/** A Setup-made bee: designed by the owner, with its portrait drawn. */
const SetupBee = BeeSchema.extend({
  name: BeeSchema.shape.name.refine((n) => !isReservedName(n), { message: "that name belongs to an official bee" }),
  rules: z.string().trim().min(10).max(500),
  look: z.string().trim().min(3).max(400),
  image: z.literal(true, { errorMap: () => ({ message: "every bee needs its portrait" }) }),
});
const SaveBody = z.object({
  jevKey: z.string().trim().min(8),
  accept: Accept,
  bees: z.array(SetupBee).length(3),
  /** Gates the dashboard's writes (joining or leaving the Hive). Stored as a salted scrypt hash only. */
  ownerPassword: z.string().min(MIN_PASSWORD).max(MAX_PASSWORD),
  /** "Join the Hive?" step: an explicit yes or no. A yes joins on the engine's first start (hive.ts). */
  hive: z.boolean().default(false),
});

export class Setup {
  private readonly openedAt: number;
  private readonly now: () => number;
  private calls = new Map<string, number>();
  private designs = 0;
  private saved = false;
  private coins: { at: number; list: string[] } | null = null;

  private checkJev: (key: string, model: string) => Promise<string | null>;
  private listCoins: () => Promise<string[]>;

  constructor(private o: SetupOpts) {
    this.now = o.now ?? Date.now;
    this.openedAt = this.now();
    this.checkJev = o.checkJev ?? checkJevKey;
    this.listCoins = o.listCoins ?? (() => fetchXperpCoins(o.okxApiBase));
  }

  /** OKX's live crypto X-Perp coins, cached for a few minutes. */
  private async coinList(): Promise<string[]> {
    if (this.coins && Date.now() - this.coins.at < COINS_TTL_MS) return this.coins.list;
    const list = await this.listCoins();
    if (!list.length) throw new Error("OKX sent an empty coin list");
    this.coins = { at: Date.now(), list };
    return list;
  }

  /** When the setup window closes (ms). */
  get closesAt(): number {
    return this.openedAt + this.o.windowMin * 60_000;
  }

  get timedOut(): boolean {
    return !this.saved && this.now() >= this.closesAt;
  }

  announce(): void {
    log.info("setup is open: open this server's address in a browser to set up your bees", { windowMin: this.o.windowMin });
    const t = setTimeout(() => {
      if (!this.saved) log.warn("setup timed out; restart the engine container to open it again");
    }, this.o.windowMin * 60_000);
    t.unref?.();
  }

  status(req: IncomingMessage) {
    return {
      needed: !this.saved,
      timedOut: this.timedOut,
      closesAt: this.closesAt,
      secure: req.headers["x-forwarded-proto"] === "https",
      styles: STYLES.map((id) => ({ id, ...STYLE_INFO[id] })),
    };
  }

  /** Handles /setup/*. Returns false if the path is not a setup route. */
  async handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
    if (!path.startsWith("/setup/")) return false;
    if (req.method === "GET" && path === "/setup/status") {
      send(res, 200, this.status(req));
      return true;
    }
    if (req.method !== "POST") {
      send(res, 405, { error: "method not allowed" });
      return true;
    }
    if (this.saved) {
      send(res, 409, { error: "Setup is already done. The engine is restarting." });
      return true;
    }
    if (this.timedOut) {
      send(res, 410, { error: TIMED_OUT, timedOut: true });
      return true;
    }
    if (path === "/setup/design" || path === "/setup/check-jev") {
      const addr = clientAddr(req.headers["x-forwarded-for"], req.socket.remoteAddress);
      const n = (this.calls.get(addr) ?? 0) + 1;
      if (n > MAX_CALLS_PER_ADDR) {
        send(res, 429, { error: "That is a lot of requests. Restart the engine to carry on." });
        return true;
      }
      this.calls.set(addr, n);
    }
    let body: Record<string, unknown>;
    try {
      body = (await readJson(req, MAX_BODY)) as Record<string, unknown>;
    } catch {
      send(res, 400, { error: "bad request" });
      return true;
    }
    try {
      await this.route(path, body, res);
    } catch (err) {
      if (err instanceof DesignError) {
        send(res, 422, { error: err.message });
        return true;
      }
      const msg = safeError(err).message;
      log.warn("setup step failed", { step: path, err: safeError(err) });
      send(res, 502, { error: msg });
    }
    return true;
  }

  private async route(path: string, body: Record<string, unknown>, res: ServerResponse) {
    switch (path) {
      case "/setup/check-jev": {
        const key = String(body.key ?? "").trim();
        if (key.length < 8) return send(res, 400, { error: "Paste your Jev API key." });
        const err = await this.checkJev(key, this.o.jevModel);
        return send(res, err ? 400 : 200, err ? { error: err } : { ok: true });
      }

      case "/setup/design": {
        const slot = Number(body.slot);
        if (!Number.isInteger(slot) || slot < 0 || slot > 2) return send(res, 400, { error: "bad bee" });
        const style = String(body.style ?? "");
        if (!(STYLES as readonly string[]).includes(style)) return send(res, 400, { error: "Pick a trading style for this bee." });
        const rawCoins = Array.isArray(body.coins) ? body.coins.map(String) : String(body.coins ?? "").split(/[\s,;/]+/);
        if (rawCoins.filter(Boolean).length > 20) return send(res, 400, { error: "A bee can trade at most 20 coins." });
        if (this.designs >= MAX_DESIGNS) return send(res, 429, { error: "That is a lot of bees. Restart the engine to design more." });
        let known: string[];
        try {
          known = await this.coinList();
        } catch (err) {
          log.warn("OKX coin list failed", { err: safeError(err) });
          return send(res, 502, { error: "Couldn't read OKX's coin list just now. Try again in a minute." });
        }
        this.designs++;
        const d = finishDesign(
          {
            name: String(body.name ?? ""),
            tagline: String(body.tagline ?? ""),
            rules: String(body.rules ?? ""),
            coins: rawCoins,
            baseStyle: style as StyleId,
            look: "",
          },
          known,
        );
        // The portrait is drawn here, from the bee's name and style: no image model, no key, no cost.
        const dir = imageDir(this.o.settingsPath);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${BEES[slot]}.svg`), portraitSvg(d.name, d.baseStyle));
        return send(res, 200, { ...d, styleLabel: STYLE_INFO[d.baseStyle].label, img: `/bee-image/${BEES[slot]}?v=${Date.now()}` });
      }

      case "/setup/save": {
        const parsed = SaveBody.safeParse(body);
        if (!parsed.success) {
          const what = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
          return send(res, 400, { error: `Something is missing or not allowed (${what}).` });
        }
        const b = parsed.data;
        const missing = BEES.filter((slot) => imagePath(this.o.settingsPath, slot) === null);
        if (missing.length) return send(res, 400, { error: "Press Create on every bee before you start." });
        const jevErr = await this.checkJev(b.jevKey, this.o.jevModel);
        if (jevErr) return send(res, 400, { error: jevErr });
        // The page's coins and style are re-checked here: coins against OKX's list (when it can be read), the style
        // against the coins.
        const known = await this.coinList().catch(() => null);
        const bees = b.bees.map((bee) => {
          const coins = known ? bee.coins.filter((c) => known.includes(c)) : bee.coins;
          return { ...bee, coins, style: deriveStyle(bee.style, coins), image: true };
        });
        const s: Settings = {
          version: 1,
          jevKey: b.jevKey,
          ownerPasswordHash: hashPassword(b.ownerPassword),
          acceptedRiskAt: Date.now(),
          bees,
          hive: b.hive,
          createdAt: Date.now(),
        };
        saveSettings(this.o.settingsPath, s);
        this.saved = true;
        log.info("setup saved; restarting into paper trading", { bees: bees.map((x) => `${x.name} (${STYLE_INFO[x.style].label})`), hive: b.hive });
        send(res, 200, { ok: true });
        setTimeout(() => this.o.onSaved(), 750);
        return;
      }

      default:
        return send(res, 404, { error: "not found" });
    }
  }
}
