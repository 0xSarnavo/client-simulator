# AGENTS.md — client-simulator operating manual

Instructions for AI coding agents (and humans) operating **client-simulator**: a CLI that sends synthetic client personas through any website's onboarding. Personas think out loud, complete or abandon the flow like real users, and produce drop-off reports.

## What client-simulator does

Simulated prospects visit a target URL in a real browser (Playwright). At each step an AI CLI — playing a persona — sees an accessibility snapshot and decides the next action: click, type, scroll, check email, pause, abandon. Everything is logged. Expert agents then review sessions and produce fix recommendations.

## Environment setup

```bash
npm install
npm run build
npx playwright install chromium   # one time
```

Requirements: Node 20+, and at least one AI CLI logged in via subscription (no API keys):
- `claude` (Claude Code)
- `opencode` (opencode)

**Verify environment (runs automatically on first visit):**

```bash
client-simulator doctor          # deep check incl. live brain call + mailbox test
client-simulator doctor --force  # re-run even if recently verified
```

Results are cached in `.clientsimulator-state.json` (gitignored) for 7 days — checks don't re-run every time.

**Optional — email verification support (OTP/magic links):** create `.env` in the project root:

```
CLIENTSIM_IMAP_HOST="imap.gmail.com"
CLIENTSIM_IMAP_USER="you@gmail.com"
CLIENTSIM_IMAP_PASS="xxxx xxxx xxxx xxxx"   # Gmail app password
CLIENTSIM_MAIL_DOMAIN="yourdomain.com"      # domain with catch-all → your inbox
```

Requires a domain whose catch-all forwards to the IMAP inbox. Without it, personas treat "check your email" walls as drop-off points (still valid data). Test with `client-simulator mailtest`.

## Choosing the AI (brain, model, effort)

Every command that calls an AI — `visit`, `all`, `fix`, `personas generate`,
`doctor` — resolves three things: which CLI plays the client, which model, and
how much reasoning effort. Pass them as flags or let it ask.

```bash
client-simulator visit <url>                                    # menus for all three
client-simulator visit <url> --brain claude                     # menus for model + effort only
client-simulator visit <url> --brain claude --model opus --effort high   # no menus
```

The menus are arrow-key driven and the lists are probed live from the CLI you
pick, not hardcoded here:

| Brain | Models from | Effort from |
|---|---|---|
| `claude` | `claude --help` aliases | `claude --help` (`low`…`max`) |
| `codex` | `codex --help`, else a fallback list | `low\|medium\|high` |
| `opencode` | `opencode models` | none — opencode has no effort knob, so it isn't asked |

Both menus always offer **default** (leave the CLI's own setting alone) and, for
models, **custom…** to type any id.

**Automation:** with no TTY nothing is ever prompted — `--brain` falls back to
`claude` and model/effort to the CLI's defaults. Always pass the flags explicitly
in scripts and CI so runs are reproducible; a session records the brain, model,
and effort it used in `meta.json`.

**Zero-argument wizard:** running bare `client-simulator` opens a guided flow
(command → url → brain → model → effort → persona counts). `--help` still prints
the flag reference. Ctrl-C out of any menu exits cleanly with status 130.

## The three stages

Stages are gated: report needs visit output; fix needs the aggregate report. Re-running a stage with no new data is a no-op ("up to date") — pass `--force` to regenerate.

### Stage 1 — visit (send prospects)

```bash
client-simulator visit <url>                          # interactive: asks how many cold/warm/hot (max 10 total)
client-simulator visit <url> --persona cold           # one cold prospect
client-simulator visit <url> --persona cold,warm,hot  # exact queue, in order (max 10)
client-simulator visit <url> --runs 6                 # 6 prospects, personas random
client-simulator visit <url> --headless               # no visible browser
```

Interactive mode asks for counts per persona (0–10 each), then shuffles the queue randomly so the site sees a natural mix. Runs execute one by one; each prints a live thought stream and finishes with a verdict (COMPLETED / ABANDONED / GUARDRAIL).

### Stage 2 — report (aggregate)

```bash
client-simulator report            # aggregates ALL sessions in runs/ -> runs/AGGREGATE.md
client-simulator report <dir>...   # aggregate specific sessions only
```

### Stage 3 — fix (expert panel)

```bash
client-simulator fix runs/<dir>            # panel reviews that session -> FIXES.md
client-simulator fix runs/<dir1> runs/<dir2>
client-simulator fix <dir> --brain opencode  # use a different brain for experts
```

### Pipeline

```bash
client-simulator all <url> --persona cold,warm,hot   # visit -> report -> fix in one go
```

## Brains

| `--brain` | CLI | Notes |
|---|---|---|
| `claude` (default) | Claude Code | Faster per step; persistent session via `--resume` |
| `opencode` | opencode | Slower (~2–3×); persistent session via `-s`; needs `--print-logs` |
| `codex` | Codex CLI | Stateless per call; journey memory comes from the prompt history |

Any brain can run any stage. You can visit with one brain and run experts with another.

## Personas

| Preset | Client | Behavior |
|---|---|---|
| `cold` | Skeptical Sam | First visit, low tech comfort, skims, distrusts forms/jargon, low patience |
| `warm` | Curious Chloe | Comparing options, wants pricing/features, tolerates minor friction |
| `hot` | Ready Rahul | Decided to buy, goes straight to signup, bails only when truly blocked |

Each persona has `otp_patience_seconds` — waiting too long for a verification email is in-character abandonment.

### Custom personas (YAML)

```bash
client-simulator personas                    # list all (built-in + custom)
client-simulator personas --new "My Persona" # scaffold personas/my-persona.yaml
client-simulator personas generate           # AI-builds a persona graph (see below)
```

#### Persona generator (AI-built persona graphs)

```bash
client-simulator personas generate --from "who buys this" --site <url> --count 4
client-simulator personas generate   # interactive: asks for site + description
```

How it works:
1. Optionally scrapes the target site's landing page (a11y text) to learn what the product is and who it serves
2. Sends your ideal-customer description + page context to the brain
3. Returns a **persona graph**: 1–2 `core` personas (your ideal customers) + `nearest-neighbor` variants (adjacent roles/industries/company sizes — companies differ)
4. Writes each as `personas/<id>.yaml` (review/edit freely; delete to remove) and prints the graph

Anti-similarity is enforced in the generation prompt: no shared traits between personas, different COMPLETE conditions per goal, mixed temperatures.

Any `.yaml`/`.yml` in `personas/` is auto-loaded; the filename becomes the persona id (custom overrides built-in on collision). Only `name`, `temperature`, `goal` are required — everything else has defaults:

```yaml
# personas/my-persona.yaml
name: "Budget Bianca"
temperature: warm            # cold | warm | hot
goal: >-
  Find a tool under $20/mo that does X. Sign up for a free trial,
  bail the moment pricing is not visible.
tech_comfort: medium         # low | medium | high (default medium)
patience_steps: 12           # max steps (default 12, max 50)
max_confusion_before_bail: 8 # confusion that pushes toward abandoning (default 8)
otp_patience_seconds: 180    # email verification wait (default 180)
traits:                      # free-text personality lines — these steer the LLM
  - "checks price before features"
  - "leaves immediately if a credit card is required for a trial"
```

Traits are the personality lever — write them like a character brief, first-person reactions the LLM should mimic. Invalid files are listed with reasons by `client-simulator personas` and skipped (never crash runs).

## Safety (hard-coded, non-negotiable)

- Never enters payment/billing flows (URL wall terminates the session)
- Never uses OAuth/SSO/social login
- Never deletes data or invites teammates

## Output layout

```
runs/
  <timestamp>-<persona>/
    session.jsonl   # one event per step: url, thought, emotion, confusion, action
    shots/          # step screenshots
    video.webm      # full browser recording
    report.md       # verdict + drop-off analysis + timeline + confusion curve
    meta.json       # machine-readable metadata for stages 2-3
    FIXES.md        # expert panel findings (after stage 3)
  AGGREGATE.md      # cross-session funnel report (after stage 2)
.clientsimulator-state.json  # doctor verification cache (gitignored)
.env                   # mail config (gitignored)
```

## Useful commands

```bash
client-simulator doctor      # verify environment
client-simulator mailtest    # mailbox create/receive/extract/destroy lifecycle test
npm run build          # compile (source is TypeScript in src/)
npm run typecheck      # tsc --noEmit
```

## Extending

- **Personas**: drop YAML in `personas/` (see Custom personas above) or add presets in `src/persona/presets.ts`
- **Experts**: implement `Expert` in `src/experts/`, register in `src/experts/index.ts`
- **Brains**: add an adapter in `src/brain/adapters/`, wire into `src/brain/index.ts`
- **Mail providers**: implement `MailProvider` in `src/mail/types.ts`
- **Brain discovery**: model/effort probing lives in `src/brain/catalog.ts`; add a
  `BrainSpec` there so a new adapter shows up in the picker
- **Prompts**: `src/ui/prompt.ts` holds the zero-dependency `select`/`text`
  primitives (raw-mode TTY, silent defaults when not interactive)

## Tips for agents operating this tool

1. Always run `client-simulator doctor` first on a new machine.
2. Pass `--brain`, `--model`, and `--effort` explicitly — an agent has no TTY, so
   omitting them silently accepts defaults rather than prompting.
3. Prefer `--headless` in CI/automation; headed mode is better for watching behavior live.
4. Read `runs/AGGREGATE.md` before individual reports — verdict summary first, details second.
5. `FIXES.md` sections are independent per expert; cite evidence lines when discussing fixes.
6. Sessions are immutable artifacts — re-run `fix` with `--force` to regenerate advice, never re-visit to "fix" a report.
7. A GUARDRAIL verdict is still valid data: it means the site blocked the client (stuck loop, broken page, payment wall), not that the tool failed.
