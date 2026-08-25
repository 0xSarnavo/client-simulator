# client-simulator

AI clients test your website's onboarding so you don't have to guess why users leave.

Each client is a persona with a personality and a goal. It browses your site in a real browser, thinks out loud at every step, and either finishes or walks out. You get the exact drop-off point, the reason in its own words, and the question it wanted answered. Then 7 expert agents turn that evidence into prioritized fixes.

```bash
git clone https://github.com/0xSarnavo/client-simulator
cd client-simulator && npm install && npm run build
npx playwright install chromium
node dist/cli.js doctor        # verifies your setup (2 min, once)
node dist/cli.js visit <url> --persona cold
```

Runs on AI CLI subscriptions (Claude Code, opencode, Codex). No API keys. No per-run fees.

---

## What you get per test

```text
runs/<timestamp>-<persona>/
├── report.md        verdict, drop-off point, reason in the client's words, confusion curve
├── session.jsonl    every thought, emotion, and action, step by step
├── video.webm       full recording of the browser session
├── shots/           screenshot of every step
├── meta.json        machine-readable metadata
└── FIXES.md         7 experts' findings after stage 3
```

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
| `--brain opencode` | swap the AI brain |
| `--mobile` | phone viewport (390×844, touch) |
| `--headless` | no browser window |
| `--force` | redo a stage even if up to date |

Stages are gated: `report` needs sessions, `fix` needs a report. Re-running with nothing new does nothing. Full details in [AGENTS.md](AGENTS.md).

---

## Personas

Three built in: **cold** (skeptical first-timer), **warm** (evaluating alternatives), **hot** (ready to buy).

Three ways to add more:

```bash
client-simulator personas --new "Budget Bianca"   # scaffold a YAML, edit it
client-simulator personas generate --site <url> --from "who buys this" --count 4
```

The generator scrapes your site, then builds a persona graph: core ideal customers plus nearest-neighbor variants (different roles, company sizes, industries). Any `.yaml` in `personas/` auto-loads. Only `name`, `temperature`, and `goal` are required.

---

## Brains

| `--brain` | Needs | Speed |
|---|---|---|
| `claude` (default) | Claude Code subscription | fast |
| `opencode` | opencode subscription | ~2-3x slower |
| `codex` | Codex CLI (`npm i -g @openai/codex`) | varies |

No model is pinned. Each brain uses whatever your CLI is configured with. Mix freely: visit with one brain, review with another.

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
5. Safety is hard-coded: never payment flows, never OAuth, never destructive actions

---

## Need something it doesn't do?

Fork it and add yours. Experts are one file each, personas are YAML, brains are one adapter. [AGENTS.md](AGENTS.md) maps every extension point.

## License

MIT
