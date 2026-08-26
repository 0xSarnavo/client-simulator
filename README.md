# client-simulator

AI clients test your website's onboarding so you don't have to guess why users leave.

Each client is a persona with a personality and a goal. It browses your site in a real browser, thinks out loud at every step, and either finishes or walks out. You get the exact drop-off point, the reason in its own words, and the question it wanted answered. Then 7 expert agents turn that evidence into prioritized fixes.

```bash
git clone https://github.com/0xSarnavo/client-simulator
cd client-simulator && npm install && npm run build
npx playwright install chromium
node dist/cli.js doctor        # verifies your setup (2 min, once)
node dist/cli.js               # guided wizard — pick everything from menus
node dist/cli.js visit <url> --persona cold
```

Runs on AI CLI subscriptions (Claude Code, opencode, Codex). No API keys. No per-run fees.

---

## What you get per test

Sessions are filed by site, then by date, so a site's history reads chronologically:

```text
runs/<site>/<date>/<time>-<persona>/
├── report.md        verdict, drop-off point, reason in the client's words, confusion curve
├── session.jsonl    every thought, emotion, and action, step by step
├── video.webm       full recording of the browser session
├── shots/           screenshot of every step
├── meta.json        machine-readable metadata (incl. brain, model, effort)
└── FIXES.md         7 experts' findings after stage 3

runs/<site>/AGGREGATE.md    funnel across every run against that site
```

`video.webm` is VP8 WebM. macOS opens it with QuickTime by default, which cannot
decode WebM — use a browser (`open -a "Brave Browser" video.webm`) or VLC.

A sample abandonment, real output:

```text
[3/20] [2/10 confusion] Ready Rahul: "Email's in. Just hit the button and get
       my code. So far this is exactly the two-minute flow I want."
[4/20] [3/10 confusion] Ready Rahul: "'Could not send the code.' Ugh, seriously?
       Fine — probably a hiccup. One retry."
...
ABANDONED at step 7
Why: "The verification code email never sends. I was ready to sign up on the
spot and the product's front door is broken."
Wanted answered: "Is your email verification service actually working?"
```

---

## Commands

```bash
client-simulator                    # guided wizard: command, url, brain, model, effort
client-simulator visit <url>        # test it (interactive: pick how many of each persona)
client-simulator report             # aggregate all sessions into one funnel report
client-simulator fix runs/<dir>     # expert panel reviews a session -> FIXES.md
client-simulator all <url>          # visit -> report -> fix in one shot
client-simulator doctor             # verify your environment
client-simulator personas           # list personas, or scaffold/generate new ones
client-simulator mailtest           # test the OTP mailbox lifecycle
```

Useful flags:

| Flag | Does |
|---|---|
| `--persona cold,warm,hot` | exact queue (max 10) |
| `--runs 6` | 6 prospects, random personas |
| `--brain opencode` | which AI CLI to use — prompted if omitted |
| `--model opus` | pin the model — prompted if omitted |
| `--effort high` | reasoning depth — prompted if omitted |
| `--plan` | re-run the first-visit site read on a known site |
| `--mobile` | phone viewport (390×844, touch) |
| `--headless` | no browser window |
| `--force` | redo a stage even if up to date |

Leave `--brain`, `--model`, or `--effort` off and you get an arrow-key menu instead.
Pass them to skip the menus; in CI (no TTY) the defaults apply silently.

Stages are gated: `report` needs sessions, `fix` needs a report. Re-running with nothing new does nothing. Full details in [AGENTS.md](AGENTS.md).

---

## First visit to a site

The first time you point it at a site, it reads the landing page and asks how you
want to test — so you're choosing personas with the page in front of you instead
of guessing:

```text
  New site — yoursite.com

  Product   Team knowledge base with AI-powered search
  For       Ops and support leads at mid-size companies
  Main CTA  "Start free trial" → email signup, no card required

  How do you want to test it?
  ❯ built-in personas       cold / warm / hot — start now
    generate for this site  personas fitted to this page
    both                    generate a set, then also pick built-in counts
```

Pick *generate* and you get a persona set built for that page, printed as a
coverage summary, then a checklist of which ones actually run. Later visits to the
same site skip straight to persona counts; `--plan` brings it back.

## Personas

Three built in: **cold** (skeptical first-timer), **warm** (evaluating alternatives), **hot** (ready to buy).

Three ways to add more:

```bash
client-simulator personas --new "Budget Bianca"   # scaffold a YAML, edit it
client-simulator personas generate --site <url> --count 6
client-simulator personas generate --from "who buys this" --count 6
```

The generator scrapes your site and builds a set spanning everyone who actually
lands on it, not variations on one ideal buyer:

| Tier | Who |
|---|---|
| `core` | your ideal customers, most likely to convert |
| `adjacent` | different roles, seniorities, company sizes, industries |
| `edge` | people who land here but aren't the target — no budget, wrong use case, a competitor sizing you up, someone who clicked the wrong ad |

It also spreads across circumstances that decide whether onboarding works at all:
low tech comfort, keyboard-only and screen-reader users, skim readers, the
privacy-sensitive, and the price-first. `--from` is optional when you pass
`--site` — the audience is inferred from the page.

`personas/` is created on demand; any `.yaml` in it auto-loads. Only `name`,
`temperature`, and `goal` are required.

---

## Brains

| `--brain` | Needs | Speed |
|---|---|---|
| `claude` (default) | Claude Code subscription | fast |
| `opencode` | opencode subscription | ~2-3x slower |
| `codex` | Codex CLI (`npm i -g @openai/codex`) | varies |

Every AI command asks which brain to use, then which model and how much reasoning
effort — nothing is pinned in this repo. The lists come from the CLI itself
(`opencode models`, `claude --help`), so new models show up without an update here.
Uninstalled CLIs appear greyed out rather than missing.

```text
  Which AI plays the client?

  ❯ claude    Claude Code      ✓ 2.1.231
    codex     Codex (ChatGPT)  ✗ not installed
    opencode  opencode         ✓ 1.18.23

  ↑↓ move · enter select · ctrl-c quit
```

Mix freely: visit with one brain, review with another. Each session records the
brain, model, and effort that produced it in `meta.json`.

---

## Email verification (OTP signups)

Clients can complete real signups. Each run mints an ephemeral mailbox (`cold.a1b2@sardomain.com`), receives the OTP or magic link, and the client types it in. Everything is purged when the run ends.

One-time setup: point a domain's catch-all at any IMAP inbox, then create `.env`:

```bash
CLIENTSIM_IMAP_HOST="imap.gmail.com"
CLIENTSIM_IMAP_USER="you@gmail.com"
CLIENTSIM_IMAP_PASS="xxxx xxxx xxxx xxxx"   # Gmail app password
CLIENTSIM_MAIL_DOMAIN="yourdomain.com"
```

Test it: `client-simulator mailtest`. Without email config, clients treat "check your inbox" walls as drop-offs, which is still useful data.

---

## Testing your own site

1. **Turn off bot protection for staging.** Cloudflare Turnstile and WAF rules will wall the client out before it sees your product.
2. **Allow-list your mail domain.** If your app rejects unknown email domains, allow your catch-all domain, or the address bounces at validation.
3. **Use staging.** The client fills real forms and creates real accounts.

Known walls: CAPTCHAs and SMS verification can't be solved (reported as drop-offs), and headless browsers get bot-checked more than headed ones.

---

## The 7 experts

Every finding is grounded in journey evidence: the client's quotes, screenshots, or fetched HTML.

| Expert | Finds |
|---|---|
| `scores` | 5-dimension scorecard: clarity, audience fit, action path, trust, content depth |
| `ux` | prioritized fixes tied to exact friction moments |
| `copywriter` | before/after rewrites of copy that lost the client |
| `trust` | missing proof, transparency, security signals; dark patterns |
| `a11y` | accessibility problems the journey actually caused (WCAG 2.2) |
| `slop` | AI-generated filler copy, with human rewrites |
| `seo` | title, meta description, heading structure, thin content |

Experts get smarter when you install [skills](https://skills.sh) on your machine (they run through claude/opencode, which auto-load them):

```bash
npx skills add addyosmani/web-quality-skills@accessibility -g -y        # a11y
npx skills add autonnel/autonnel-skills@landing-page-conversion-audit -g -y  # ux
npx skills add github/awesome-copilot@web-design-reviewer -g -y         # ux
npx skills add onewave-ai/claude-skills@landing-page-copywriter -g -y   # copywriter
npx skills add content-designer/ux-writing-skill@ux-writing -g -y       # copywriter
npx skills add petergyang/no-ai-slop@no-ai-slop -g -y                   # slop
npx skills add coreyhaines31/marketingskills@seo-audit -g -y            # seo
npx skills add wshobson/agents@responsive-design -g -y                  # mobile runs
npx skills add phuryn/pm-skills@user-personas -g -y                     # persona generator
```

---

## How it works, briefly

1. Playwright opens the site and captures an accessibility tree plus screenshot
2. The persona brain (your AI CLI) sees it and answers in strict JSON: thought, emotion, confusion, next action
3. The harness executes the action and logs everything
4. Guardrails keep sessions honest: stuck-loop detection, failure retries, patience caps, and a verification call that challenges any "I'm done" claim
5. Safety is enforced on actions, not pages: clients may read pricing and reach a checkout, but the harness refuses card entry, common payment-commit buttons and third-party sign-in (best-effort label matching — see AGENTS.md)

---

## Need something it doesn't do?

Fork it and add yours. Experts are one file each, personas are YAML, brains are one adapter. [AGENTS.md](AGENTS.md) maps every extension point.

## License

MIT
