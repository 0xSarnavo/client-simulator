# client-sim

**Send synthetic clients through any website's onboarding. They think out loud, get confused, and walk out. You get a report on exactly where they dropped off and why.**

It's automated user testing with simulated humans. A persona (like "Skeptical Sam", a first-time visitor who's never heard of the product) browses your site in a real browser, decides every click like a real person would, and leaves behind a complete log of its thoughts. When it walks out, you get the drop-off point, the reason in its own words, and the question it wanted answered. A panel of expert agents then turns that evidence into prioritized fixes.

```
$ client-sim visit https://yoursite.com/signup --persona cold

  Skeptical Sam (cold) is visiting https://yoursite.com/signup
  [1/12] [4/10 confusion] Skeptical Sam: "Okay, what is this? The hero says
         'Synergize your workflow'... synergize WHAT?"
  [2/12] [7/10 confusion] Skeptical Sam: "I've scrolled twice and I still
         can't tell what this costs. I'm not making an account to find out."

  ============================================================
    ABANDONED
    Where: step 2 on https://yoursite.com/pricing
    Why: "No visible pricing anywhere. A mailto link is not pricing."
    Wanted answered: "What does this cost and is there a free tier?"
  ============================================================
```

---

## How it works

```
                    persona YAML (who the client is)
                              │
                              ▼
        ┌─────────  STEP LOOP (per page)  ─────────┐
        │                                          │
        │  1. CAPTURE   accessibility tree +       │
        │               screenshot + video frame   │
        │  2. THINK     AI CLI (Claude/opencode)   │
        │               decides in-character:      │
        │               thought, emotion,          │
        │               confusion 0-10, action     │
        │  3. ACT       click / type / scroll /    │
        │               check email / back /       │
        │               abandon / complete         │
        │  4. LOG       every thought -> JSONL     │
        │                                          │
        └──────────────────────────────────────────┘
                              │
              ┌───────────────┼────────────────┐
              ▼               ▼                ▼
        session.jsonl    report.md        video.webm
              │
              ▼
     AGGREGATE.md (all sessions)      FIXES.md (7 expert agents)
```

The client is an **AI CLI you already pay for**  (Claude Code or opencode subscription). No API keys. No per-run fees. The whole conversation lives in one persistent session, so the persona remembers everything it saw and thought.

**Hard safety rules** (enforced by the harness, not the prompt): the client never enters payment/billing flows, never uses OAuth/SSO social login, never deletes data or invites teammates.

---

## Requirements

| Need | Why | Check |
|---|---|---|
| Node.js 20+ | runtime | `node --version` |
| Playwright chromium | the browser clients browse in | `npx playwright install chromium` |
| Claude Code **or** opencode, logged in | the persona's brain | `claude --version` / `opencode --version` |

Optional: a domain with catch-all email forwarding → any IMAP inbox, for testing flows that require email verification (OTP codes, magic links).

---

## Install

```bash
git clone <this-repo> client-sim
cd client-sim
npm install
npm run build
npx playwright install chromium
```

Then verify everything:

```bash
node dist/cli.js doctor
```

`doctor` deep-checks your environment: Node version, chromium launches, both AI CLIs, a **live brain call**, and a **live mailbox create/destroy** if email is configured. Results are cached for 7 days (`.clientsim-state.json`), so it doesn't re-check every run. `--force` re-verifies. On your first `visit`, doctor runs automatically and prints the command cheat-sheet when everything passes.

Tip: `npm link` makes `client-sim` callable from anywhere.

---

## Usage: three stages, any combination

```bash
# STAGE 1: send prospects (one session per persona)
client-sim visit <url>                          # interactive: asks how many cold/warm/hot
client-sim visit <url> --persona cold           # one specific persona
client-sim visit <url> --persona cold,warm,hot  # exact queue, run in order (max 10)
client-sim visit <url> --runs 6                 # 6 prospects, personas chosen at random
client-sim visit <url> --mobile                 # phone viewport: 390×844, touch, iPhone UA

# STAGE 2: aggregate funnel report across all sessions
client-sim report

# STAGE 3: expert panel reviews sessions -> FIXES.md
client-sim fix runs/<dir> [moreDirs...]

# ALL THREE IN ONE SHOT
client-sim all <url> --persona cold,warm,hot
```

**Stage rules:** `report` refuses to run without sessions; `fix` refuses without an aggregate report. Re-running a stage with no new data tells you it's up to date instead of redoing work. Pass `--force` to regenerate deliberately.

**Interactive planner:** with no `--persona`/`--runs`, visit asks how many cold, warm, and hot prospects to send (0–10 each), shuffles the order randomly, and runs them one by one.

**All options:**

| Flag | Values | Default |
|---|---|---|
| `--persona` | comma list of persona ids (max 10) | interactive prompt |
| `--runs` | number 1–10, personas random | interactive prompt |
| `--brain` | `claude`, `opencode` | `claude` |
| `--headless` | — | headed (watch the client browse live) |
| `--mobile` | — | desktop (1280×800) |
| `--force` | — | off |

---

## Personas

A persona is who visits. It has two layers:

- **Prompt layer** (personality): `name`, `temperature`, `goal`, `tech_comfort`, `traits` (injected into every thinking step), so the AI literally becomes this person
- **Code layer** (guardrails): `patience_steps` (session cap) and `otp_patience_seconds` (email-wait budget). Both enforced no matter what

Two personas are meaningfully different only if they differ on 3+ axes and have different "COMPLETE" conditions.

### Built-in

| id | Client | Temperature | Behavior |
|---|---|---|---|
| `cold` | Skeptical Sam | cold | First visit ever, skims, distrusts forms and jargon, low patience |
| `warm` | Curious Chloe | warm | Comparing alternatives, wants pricing/features, tolerates minor friction |
| `hot` | Ready Rahul | hot | Already decided, straight to signup, bails only when truly blocked |

### Your own, two ways

**1. Scaffold and edit:**

```bash
client-sim personas --new "Budget Bianca"
# creates personas/budget-bianca.yaml. Edit it, then:
client-sim visit <url> --persona budget-bianca
```

Only `name`, `temperature`, `goal` are required. Everything else has defaults:

```yaml
name: "Budget Bianca"
temperature: warm            # cold | warm | hot
goal: >-
  Find a tool under $20/mo. Bail the moment pricing is hidden.
tech_comfort: medium         # low | medium | high        (default: medium)
patience_steps: 12           # session step cap           (default: 12,  max 50)
max_confusion_before_bail: 8 # confusion that pushes toward leaving (default: 8)
otp_patience_seconds: 180    # email-wait budget          (default: 180)
traits:                      # the personality lever: concrete behavioral rules
  - "checks price before features"
  - "leaves if a card is required for a trial"
```

**2. Let AI generate a whole persona graph:**

```bash
client-sim personas generate --site <url> --from "who buys this" --count 4
# or fully interactive: client-sim personas generate
```

It scrapes the target site to learn what the product actually is, then builds a **persona graph**: 1–2 *core* personas (your ideal customers) plus *nearest-neighbor* variants (adjacent roles, company sizes, industries. Companies differ.). Anti-similarity is enforced: no trait shared between personas, every goal has a different completion condition, temperatures are mixed.

```bash
client-sim personas    # list everything available
```

Any `.yaml` in `personas/` is auto-loaded (filename = persona id). Invalid files are reported with reasons, never crash runs.

---

## Brains

The persona's thinking runs through an AI CLI **subscription**. No API keys:

| `--brain` | CLI | Notes |
|---|---|---|
| `claude` (default) | Claude Code | Faster per step; persistent session via `--resume` |
| `opencode` | opencode | ~2–3× slower; persistent session via `-s` |

Any brain can run any stage. Visit with one, run the expert panel with another.

---

## Email verification (OTP / magic links)

Personas can complete real signups. Mailboxes are **ephemeral**: a fresh alias (`cold.a1b2c3@yourdomain.com`) is minted per run, used in signup forms, polled for verification codes/links. Every message addressed to it is purged when the run ends.

**One-time setup:** point a domain's catch-all at any IMAP inbox.

Example with Namecheap/Cloudflare forwarding → Gmail:
1. Set catch-all `*@yourdomain.com` → forward to your Gmail
2. Gmail: enable IMAP (Settings → Forwarding and POP/IMAP) + keep Auto-Expunge **on** (default)
3. Create a Gmail app password (needs 2FA): myaccount.google.com/apppasswords
4. Create `.env` in the project root:

```bash
CLIENTSIM_IMAP_HOST="imap.gmail.com"
CLIENTSIM_IMAP_USER="you@gmail.com"
CLIENTSIM_IMAP_PASS="xxxx xxxx xxxx xxxx"
CLIENTSIM_MAIL_DOMAIN="yourdomain.com"
```

Test the full lifecycle:

```bash
client-sim mailtest   # creates a mailbox, waits for you to email it, extracts codes, destroys it
```

Without email configured, personas treat "check your inbox" walls as drop-off points, which is still honest data. Each persona's `otp_patience_seconds` means slow verification emails cause in-character abandonment, exactly like real users.

---

## The expert panel

`client-sim fix` sends each session to a panel of specialist agents. Every finding is grounded in journey evidence: quotes from the client's thoughts, screenshots, or fetched HTML.

| Expert | Reviews | Produces |
|---|---|---|
| `scores` | overall experience | 5-dimension scorecard: message clarity, audience fit, action path, trust, content depth, with per-dimension notes and overall score |
| `ux` | friction | Prioritized fixes: problem → evidence → concrete fix → copy rewrite |
| `copywriter` | words | Before/after rewrite tables for copy that confused or lost the persona |
| `trust` | credibility | Trust-signal audit: proof, transparency, security mentions, dark patterns |
| `a11y` | accessibility | Issues evidenced by the accessibility-tree journey (WCAG 2.2) |
| `slop` | authenticity | AI-generated filler detection: verbatim quotes, the tell, human rewrites. Reports "clean" honestly when copy is fine |
| `seo` | discoverability | On-page basics: title tag, meta description, heading structure, thin content (inspects raw HTML) |

### Skills that power the experts

Experts run through claude/opencode, which auto-load installed **skills** (reusable knowledge packages from [skills.sh](https://skills.sh)). Install any of these and the matching expert gets smarter. No configuration:

```bash
npx skills add addyosmani/web-quality-skills@accessibility -g -y        # 47K  -> a11y: WCAG 2.2 framework
npx skills add autonnel/autonnel-skills@landing-page-conversion-audit -g -y  # 26K -> ux: conversion heuristics
npx skills add wshobson/agents@responsive-design -g -y                  # 17K  -> mobile/responsive review
npx skills add github/awesome-copilot@web-design-reviewer -g -y         # 13K  -> ux: design review
npx skills add onewave-ai/claude-skills@landing-page-copywriter -g -y   # 5.8K -> copywriter: conversion copy
npx skills add phuryn/pm-skills@user-personas -g -y                     # 2.3K -> persona generator
npx skills add content-designer/ux-writing-skill@ux-writing -g -y       # 1.6K -> copywriter: microcopy
npx skills add petergyang/no-ai-slop@no-ai-slop -g -y                   # 7.3K -> slop: AI-writing tells
npx skills add coreyhaines31/marketingskills@seo-audit -g -y            # 194K -> seo: on-page checklist
npx skills add owl-listener/designer-skills@critique-information-density -g -y # -> ux: content overload
```

Each expert's prompt references its skills explicitly, so installation is the only step.

---

## Output layout

```
runs/
  <timestamp>-<persona>/
    session.jsonl   # one event per step: url, thought, emotion, confusion, action
    shots/          # screenshot of every step
    video.webm      # full recording of the browser session
    report.md       # verdict, drop-off analysis, journey timeline, confusion curve
    meta.json       # machine-readable metadata (url, persona, brain, exit, viewport)
    FIXES.md        # expert panel findings (after stage 3)
  AGGREGATE.md      # cross-session funnel report: verdict summary, per-persona
                    #   breakdown, most common drop points, verbatim complaints
.clientsim-state.json  # doctor verification cache (gitignored)
.env                   # mail configuration (gitignored)
personas/              # your custom persona YAML files
```

---

## Reading a report

- **COMPLETED**: the persona achieved its goal (verified: a second brain call double-checks the claim before accepting it)
- **ABANDONED**: the persona walked out. The report shows the exact step, the reason in its own words, and the question it wanted answered. This is the part you built the tool for
- **GUARDRAIL**: the harness terminated the session: stuck loop (same action 3×), broken page (4 failed actions), patience cap, or safety wall. Still valid data: it means the site blocked the client, not that the tool failed

The confusion curve (▁▂▄█ per step) shows where friction spiked. FIXES.md sections are independent per expert.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `doctor` fails on chromium | `npx playwright install chromium` |
| No AI CLI found | Install Claude Code or opencode and log in |
| Mailbox test: `AUTHENTICATIONFAILED` | Gmail needs an **app password** (not login password) + IMAP enabled |
| Forwarded mail never arrives | Check Gmail spam once (mark "not spam"); verify the catch-all rule at your registrar |
| Destroy leaves messages | Gmail: keep Auto-Expunge **on** (Settings → Forwarding and POP/IMAP) |
| Session dies with brain error | Rate limits. Wait a minute, or switch `--brain` |
| Everything hangs on interactive prompt | Pass `--persona` / `--runs` explicitly; prompts also auto-default after 2 minutes |

---

## Project layout

```
src/
  cli.ts               # commands: visit / report / fix / all / doctor / personas / mailtest
  session.ts           # the step loop: think -> act -> log -> guardrails
  doctor.ts            # environment verification with state cache
  browser/driver.ts    # Playwright: snapshots, actions, screenshots, video
  brain/
    prompt.ts          # persona + memory + snapshot -> prompt; verification prompt
    adapters/          # claude.ts, opencode.ts (persistent sessions)
  persona/
    presets.ts         # built-in cold/warm/hot
    load.ts            # YAML loading, validation, scaffolding
    generate.ts        # AI persona-graph generation (+ site scraper)
  mail/                # ephemeral mailbox providers (IMAP)
  experts/             # the 7 review agents + registry
  log/                 # JSONL events, reports, aggregate
personas/              # your custom persona YAMLs
AGENTS.md              # operating manual written for AI agents
```

## Extending

- **Persona**: drop YAML in `personas/`
- **Expert**: implement the `Expert` interface in `src/experts/`, add one line to the registry
- **Brain**: one adapter file in `src/brain/adapters/`
- **Mail provider**: implement `MailProvider` (create/fetchNew/destroy)

## License

MIT
