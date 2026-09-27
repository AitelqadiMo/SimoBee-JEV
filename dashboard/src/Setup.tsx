// First-run Setup: shown instead of the dashboard until the engine has a Jev key. No code needed: the first person to
// finish it owns the server, and it closes for good once saved (or times out after SETUP_WINDOW_MIN, until the engine
// restarts). The owner picks an owner password here for later dashboard writes. Keys go straight to the engine.
// SimoBee fork: no OpenAI. The owner designs each bee by hand (name, tagline, style, coins, rules); the engine checks
// the coins against OKX's live list, picks the style that can trade them, and draws the bee's portrait locally.
import { useEffect, useState } from "react";
import { BEE_MARK_URL } from "./BeeMark";

interface StyleInfo {
  id: string;
  label: string;
  blurb: string;
  name: string;
  tagline: string;
}
interface Status {
  needed: boolean;
  timedOut: boolean;
  closesAt: number;
  secure: boolean;
  styles: StyleInfo[];
}
interface Design {
  name: string;
  tagline: string;
  rules: string;
  coins: string[];
  baseStyle: string;
  styleLabel: string;
  look: string;
  /** Why the bee runs on a different brain than the one it was designed for. */
  styleNote?: string;
}
/** What the owner types for one bee. */
interface BeeForm {
  name: string;
  tagline: string;
  style: string;
  /** Comma-separated tickers; empty = any coin. */
  coins: string;
  rules: string;
}
interface BeeDraft {
  form: BeeForm;
  /** The bee as the engine checked it (null until "Create my bee"; cleared when the form changes). */
  design: Design | null;
  img: string | null;
  busy: "" | "design";
  error: string;
}

/** Starting points, one per slot, so Setup works with three clicks. Change anything. */
const DEFAULTS: BeeForm[] = [
  {
    name: "Steady",
    tagline: "the calm one",
    style: "breezy",
    coins: "BTC, ETH",
    rules: "Follow the trend on BTC and ETH only. Trade rarely, let winners run, and cut losers quickly.",
  },
  {
    name: "Sparky",
    tagline: "the breakout hunter",
    style: "bizzy",
    coins: "BTC, ETH, SOL",
    rules: "Wait for one clean volatility breakout a day and ride it. Skip choppy, low-volume days.",
  },
  {
    name: "Rocket",
    tagline: "the risk taker",
    style: "boozy",
    coins: "",
    rules: "Chase the strongest liquid mover of the week and add to winners. Get out fast when momentum fades.",
  },
];

/** Same rule as the engine: the official bees' names (and obvious spellings) are theirs. */
const squash = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .replace(/bee$/, "")
    .replace(/(.)\1+/g, "$1")
    .replace(/(ie|ey|i)$/, "y");
const RESERVED = new Set(["bizzy", "breezy", "boozy"].map(squash));
const nameProblem = (name: string): string | null =>
  !/^[\p{L}\p{N} .'_-]{1,24}$/u.test(name.trim())
    ? "Names are 1-24 letters, numbers, spaces and . ' _ -"
    : RESERVED.has(squash(name))
      ? "Bizzy, Breezy and Boozy are the official bees. Pick another name."
      : null;

const STEPS = ["The rules", "Password", "Jev", "Your bees", "Start"] as const;

class TimedOut extends Error {}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`/setup/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (r.status === 410) throw new TimedOut(j.error ?? "Setup timed out.");
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j;
}

export function Setup() {
  const [status, setStatus] = useState<Status | null>(null);
  const [step, setStep] = useState(0);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [timedOut, setTimedOut] = useState(false);
  const [accept, setAccept] = useState({ notAdvice: false, paperDefault: false, ownRisk: false });
  const [jevKey, setJevKey] = useState("");
  const [jevOk, setJevOk] = useState(false);
  const [bees, setBees] = useState<BeeDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    void fetch("/setup/status", { cache: "no-store" })
      .then((r) => r.json() as Promise<Status>)
      .then((s) => {
        setStatus(s);
        setBees(DEFAULTS.map((form) => ({ form: { ...form }, design: null, img: null, busy: "", error: "" })));
      })
      .catch(() => setError("Can't reach the engine. Give it a few seconds, then reload."));
  }, []);

  // After saving, the engine restarts. Wait for it to come back set up, then load the dashboard.
  useEffect(() => {
    if (!done) return;
    const t = setInterval(() => {
      void fetch("/profile", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((p: { setup?: boolean } | null) => {
          if (p && p.setup === false) location.reload();
        })
        .catch(() => undefined);
    }, 2000);
    return () => clearInterval(t);
  }, [done]);

  /** The message for an error; a timed-out Setup switches the whole page to the restart hint. */
  const fail = (e: unknown) => {
    if (e instanceof TimedOut) setTimedOut(true);
    return (e as Error).message;
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(fail(e));
    } finally {
      setBusy(false);
    }
  };

  const patch = (i: number, p: Partial<BeeDraft>) => setBees((bs) => bs.map((b, j) => (j === i ? { ...b, ...p } : b)));

  /** Editing a bee after Create means it has to be checked again. */
  const edit = (i: number, p: Partial<BeeForm>) => setBees((bs) => bs.map((b, j) => (j === i ? { ...b, form: { ...b.form, ...p }, design: null } : b)));

  const create = async (i: number) => {
    const f = bees[i]!.form;
    patch(i, { busy: "design", error: "" });
    try {
      const d = await post<Design & { img: string }>("design", { slot: i, name: f.name.trim(), tagline: f.tagline.trim(), style: f.style, coins: f.coins, rules: f.rules.trim() });
      patch(i, { design: d, img: d.img, busy: "" });
    } catch (e) {
      patch(i, { busy: "", error: fail(e) });
    }
  };

  const save = () =>
    run(async () => {
      await post("save", {
        jevKey,
        accept,
        ownerPassword: password,
        bees: bees.map((b) => ({
          name: b.design!.name.trim(),
          style: b.design!.baseStyle,
          tagline: b.design!.tagline.trim(),
          rules: b.design!.rules,
          coins: b.design!.coins,
          look: b.design!.look,
          image: !!b.img,
        })),
        hive: false,
      });
      setDone(true);
    });

  if (!status) {
    return (
      <div className="setup">
        <div className="setup-card">
          <h1>beebots</h1>
          <p className="dim">{error || "Loading…"}</p>
        </div>
      </div>
    );
  }

  if (timedOut || status.timedOut) {
    return (
      <div className="setup">
        <div className="setup-card center">
          <h1>Setup timed out</h1>
          <p>
            Setup timed out to keep this server safe. Restart the engine container (Hostinger <b>Docker Manager</b> → <b>Restart</b>, or{" "}
            <code>docker compose restart engine</code>) to open it again.
          </p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="setup">
        <div className="setup-card center">
          <h1>Starting your bees 🐝</h1>
          <p>Saved. The engine is restarting in paper trading. This page opens the dashboard as soon as it's back, usually within a minute.</p>
        </div>
      </div>
    );
  }

  const beesReady = bees.length === 3 && bees.every((b) => b.design && b.img && !nameProblem(b.design.name));
  const dupNames = new Set(bees.map((b) => b.form.name.trim().toLowerCase())).size < bees.length;
  const anyBusy = busy || bees.some((b) => b.busy);

  return (
    <div className="setup">
      <div className="setup-card">
        <div className="setup-head">
          <h1>beebots setup</h1>
          <ol className="setup-steps">
            {STEPS.map((s, i) => (
              <li key={s} className={i === step ? "on" : i < step ? "done" : ""}>
                {s}
              </li>
            ))}
          </ol>
        </div>

        {!status.secure && (
          <div className="setup-warn">
            This page is on plain HTTP, so your keys travel unencrypted. For a quick paper-trading test that's a small risk. For anything longer,
            point a domain at the server and set <code>PUBLIC_DOMAIN</code> so it gets HTTPS (see the README).
          </div>
        )}

        {step === 0 && (
          <section>
            <h2>Before anything else</h2>
            <p>beebots is an experiment and a piece of open-source software, not a trading product. Tick all three to carry on.</p>
            <label className="setup-check">
              <input type="checkbox" checked={accept.notAdvice} onChange={(e) => setAccept({ ...accept, notAdvice: e.target.checked })} />
              <span>
                <b>This is not financial advice.</b> Nothing the bees do, and nothing in the video or the code, is a recommendation to buy or sell anything.
              </span>
            </label>
            <label className="setup-check">
              <input type="checkbox" checked={accept.paperDefault} onChange={(e) => setAccept({ ...accept, paperDefault: e.target.checked })} />
              <span>
                <b>My bees trade on paper.</b> They use real market prices and simulated money. Nothing touches an exchange account unless I change the
                server settings myself, on purpose.
              </span>
            </label>
            <label className="setup-check">
              <input type="checkbox" checked={accept.ownRisk} onChange={(e) => setAccept({ ...accept, ownRisk: e.target.checked })} />
              <span>
                <b>I use it at my own risk.</b> The software comes with no warranty (MIT licence). Leveraged crypto trading can lose everything you put in, and if
                I ever switch it to real money, that's on me.
              </span>
            </label>
            <div className="setup-actions">
              <button disabled={!accept.notAdvice || !accept.paperDefault || !accept.ownRisk} onClick={() => setStep(1)}>
                I agree
              </button>
            </div>
          </section>
        )}

        {step === 1 && (
          <section>
            <h2>Pick an owner password</h2>
            <p>
              Your dashboard is public, so anything you change from it later (like joining or leaving the Hive) asks for this password. Pick one only
              you know, at least 8 characters. The server keeps only a scrambled (hashed) copy, so write it down: to reset it, run Setup again (see the
              README).
            </p>
            <input
              className="setup-input"
              type="password"
              autoComplete="new-password"
              placeholder="Owner password (8+ characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
            <input className="setup-input" type="password" autoComplete="new-password" placeholder="Type it again" value={password2} onChange={(e) => setPassword2(e.target.value)} />
            {password.length > 0 && password.length < 8 && <p className="setup-err small">At least 8 characters.</p>}
            {password2.length > 0 && password.length >= 8 && password2 !== password && <p className="setup-err small">The two don't match yet.</p>}
            <div className="setup-actions">
              <button className="ghost" onClick={() => setStep(0)}>
                Back
              </button>
              <button disabled={password.length < 8 || password.length > 200 || password !== password2} onClick={() => setStep(2)}>
                Next
              </button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section>
            <h2>Your Jev key</h2>
            <p>
              Jev (from TypeSafe AI) makes every decision. Get a key at{" "}
              <a href="https://console.typesafe.ai/keys" target="_blank" rel="noopener">
                console.typesafe.ai/keys
              </a>
              . Jev charges per decision. This setup asks Jev every 30 seconds per bee and caps Jev spending at $0.50 a day (change{" "}
              <code>TICK_MS</code> and <code>JEV_DAILY_USD_CAP</code> in <code>.env</code>).
            </p>
            <input
              className="setup-input mono"
              type="password"
              autoComplete="off"
              placeholder="Jev API key"
              value={jevKey}
              onChange={(e) => (setJevKey(e.target.value), setJevOk(false))}
            />
            {jevOk && <p className="setup-ok">✓ Jev answered. Key works.</p>}
            <div className="setup-actions">
              <button className="ghost" onClick={() => setStep(1)}>
                Back
              </button>
              {jevOk ? (
                <button onClick={() => setStep(3)}>Next</button>
              ) : (
                <button disabled={busy || jevKey.trim().length < 8} onClick={() => run(async () => (await post("check-jev", { key: jevKey.trim() }), setJevOk(true)))}>
                  {busy ? "Checking…" : "Check key"}
                </button>
              )}
            </div>
          </section>
        )}

        {step === 3 && (
          <section>
            <h2>Design your bees</h2>
            <p>
              Three bees trade side by side and race each other. Each one runs on a built-in trading style; your rules go to Jev with every decision
              and steer which move it picks. Leave the coins empty to let a bee trade any liquid coin. The examples below work as they are: press{" "}
              <b>Create my bee</b> on each one, or change anything first.
            </p>
            <div className="setup-bees">
              {bees.map((b, i) => {
                const d = b.design;
                const f = b.form;
                const problem = nameProblem(f.name);
                const styleInfo = status.styles.find((x) => x.id === f.style);
                return (
                  <div className="setup-bee" key={i} style={{ ["--bee" as string]: `var(--${["bizzy", "breezy", "boozy"][i]})` }}>
                    <div className={`setup-portrait ${b.img && d ? "" : "empty"}`}>
                      <img src={b.img && d ? b.img : BEE_MARK_URL} alt={b.img && d ? `${d.name} portrait` : "not created yet"} />
                    </div>
                    <label className="setup-label" htmlFor={`name-${i}`}>
                      Name
                    </label>
                    <input id={`name-${i}`} className="setup-input setup-name" maxLength={24} value={f.name} onChange={(e) => edit(i, { name: e.target.value })} />
                    {f.name.trim() && problem && <p className="setup-err small">{problem}</p>}
                    <label className="setup-label" htmlFor={`tag-${i}`}>
                      Tagline
                    </label>
                    <input id={`tag-${i}`} className="setup-input small" maxLength={40} value={f.tagline} onChange={(e) => edit(i, { tagline: e.target.value })} />
                    <label className="setup-label" htmlFor={`style-${i}`}>
                      Trading style
                    </label>
                    <select id={`style-${i}`} className="setup-input small" value={f.style} onChange={(e) => edit(i, { style: e.target.value })}>
                      {status.styles.map((st) => (
                        <option key={st.id} value={st.id}>
                          {st.label}
                        </option>
                      ))}
                    </select>
                    {styleInfo && <p className="dim small">{styleInfo.blurb}</p>}
                    <label className="setup-label" htmlFor={`coins-${i}`}>
                      Coins (comma-separated, empty = any)
                    </label>
                    <input
                      id={`coins-${i}`}
                      className="setup-input small mono"
                      placeholder="e.g. BTC, ETH"
                      value={f.coins}
                      onChange={(e) => edit(i, { coins: e.target.value.toUpperCase() })}
                    />
                    <label className="setup-label" htmlFor={`rules-${i}`}>
                      Rules for Jev
                    </label>
                    <textarea
                      id={`rules-${i}`}
                      className="setup-input small"
                      rows={3}
                      maxLength={500}
                      value={f.rules}
                      onChange={(e) => edit(i, { rules: e.target.value })}
                    />
                    <button className={d ? "ghost" : ""} disabled={!!b.busy || !!problem || f.rules.trim().length < 10} onClick={() => void create(i)}>
                      {b.busy === "design" ? "Checking…" : d ? "✓ Created · create again" : "Create my bee"}
                    </button>
                    {d && (
                      <div className="setup-design">
                        <div className="setup-coins">
                          {d.coins.length ? d.coins.map((c) => <span key={c} className="coin-chip">{c}</span>) : <span className="coin-chip any">any coin</span>}
                          <span className="dim small">runs on {d.styleLabel}</span>
                        </div>
                        {d.styleNote && <p className="setup-note small">{d.styleNote}</p>}
                      </div>
                    )}
                    {b.error && <p className="setup-err small">{b.error}</p>}
                  </div>
                );
              })}
            </div>
            <div className="setup-actions">
              {!beesReady && <span className="dim small setup-hint">Press Create my bee on all three bees to carry on.</span>}
              {dupNames && <span className="setup-err small setup-hint">Give each bee its own name.</span>}
              <button className="ghost" onClick={() => setStep(2)}>
                Back
              </button>
              <button disabled={!beesReady || dupNames || anyBusy} onClick={() => setStep(4)}>
                Next
              </button>
            </div>
          </section>
        )}

        {step === 4 && (
          <section>
            <h2>Ready</h2>
            <ul className="setup-summary">
              {bees.map((b, i) => (
                <li key={i}>
                  <img src={b.img ?? BEE_MARK_URL} alt="" />
                  <span>
                    <b>{b.design?.name}</b> {b.design?.tagline && <span className="dim">{b.design.tagline}</span>}
                    <br />
                    <span className="dim small">{b.design?.coins.length ? b.design.coins.join(", ") : "any coin"} · {b.design?.styleLabel}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p>
              Each bee starts with <b>$333 of paper money</b>, and trades OKX perpetuals at real prices. The engine saves your settings, restarts, and opens
              the live dashboard. The setup page then closes for good. To run it again later, see LOCAL_SETUP.md.
            </p>
            <p className="dim small">The Hive (the public leaderboard at beebots.tech) stays off. Nothing about your bees leaves this machine.</p>
            <div className="setup-actions">
              <button className="ghost" onClick={() => setStep(3)}>
                Back
              </button>
              <button disabled={busy} onClick={() => void save()}>
                {busy ? "Saving…" : "Start paper trading"}
              </button>
            </div>
          </section>
        )}

        {error && <p className="setup-err">{error}</p>}
        <p className="setup-foot dim small">Not financial advice. Open source, MIT licence, no warranty.</p>
      </div>
    </div>
  );
}
