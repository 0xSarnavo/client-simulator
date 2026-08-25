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

#### First visit to a site

When `runs/<site>/` does not exist yet and no `--persona`/`--runs` was given, an
interactive `visit` first reads the landing page and offers a choice:

1. Scrapes the page and asks the brain for three things: what the product is, who
   it appears to be for, and the primary CTA. Failure here is non-fatal — the run
   continues without the read.
2. Offers **built-in personas** (cold/warm/hot), **generate for this site**, or
   **both**.
3. On generate: writes the persona set, prints the coverage summary, then a
   multi-select of which personas actually run (one session each).

Later visits to the same site skip it. `--plan` forces it back on a known site.
Non-interactive shells never see it — flags decide everything, as before.

### Stage 2 — report (aggregate)

```bash
client-simulator report            # one funnel per site -> runs/<site>/AGGREGATE.md
client-simulator report <dir>...   # aggregate specific sessions only
```

Sessions are grouped by the URL recorded in each `meta.json`, not by where they
sit on disk, so a session moved between folders still lands in the right funnel.
Stage 3 is gated on the aggregate for that session's own site.

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
| `claude` (default) | Claude Code | Fastest per step |
| `opencode` | opencode | Slower (~2–3×); needs `--print-logs` |
| `codex` | Codex CLI | Varies by model |

Any brain can run any stage. You can visit with one brain and run experts with another.

### How brains are isolated

Every session gets its own brain instance, and every call is stateless — journey
memory comes only from the tiered history the prompt builder renders. This matters
for correctness, not just cost: brains used to be module-level singletons holding a
persistent CLI session, so persona 2 inherited persona 1's entire conversation and
was no longer a first-time visitor.

Calls run with the working directory outside the repo, so the CLI does not load
this project's own `AGENTS.md` into a persona that is supposed to know nothing
about it. The session directory is opted back in via `--add-dir` so screenshots
stay readable.

Tools are restricted by role (`src/brain/adapters/claude.ts`):

| Role | Tools | Why |
|---|---|---|
| `persona` | `Read` only | It must judge the page from the snapshot and its own screenshot — not shell out or fetch the URL directly |
| `expert` | `Read`, `Bash`, `WebFetch`, search | Expert prompts explicitly invite reading screenshots and curling the page for raw HTML |

Unused tool schemas cost roughly 5k tokens on every single call, so this is a
substantial saving as well as a correctness boundary.

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
client-simulator personas generate           # AI-builds a persona set (see below)
```

#### Persona generator (AI-built persona sets)

```bash
client-simulator personas generate --from "who buys this" --site <url> --count 4
client-simulator personas generate   # interactive: asks for site + description
```

How it works:
1. Optionally scrapes the target site's landing page (a11y text) to learn what the product is and who it serves
2. Sends the page context plus your description (optional when `--site` is given) to the brain
3. Returns a set spread across three tiers, roughly a third each:
   - `core` — the ideal customers, most likely to convert
   - `adjacent` — different roles, seniorities, company sizes, industries
   - `edge` — people who land on the site but are not the target: no budget, wrong
     use case, a competitor evaluating, an enterprise buyer in a self-serve flow.
     These expose whether onboarding qualifies people fast or wastes their time.
4. Writes each as `personas/<id>.yaml` (review/edit freely; delete to remove) and prints a coverage summary

The set is also spread across circumstances that decide whether onboarding works
at all — tech comfort (at least one `low`), urgency, trust posture, price
sensitivity, skim-reading, and (at `--count` 4+) at least one persona with a real
accessibility constraint.

Anti-similarity is enforced in the prompt: any two personas differ on at least
three axes, no trait repeats, each goal has its own COMPLETE condition, and
temperatures are mixed.

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
  <site>/                        # hostname, www. stripped (e.g. example.com)
    AGGREGATE.md                 # funnel across this site's sessions (after stage 2)
    .aggregate-manifest.json     # stage-2 up-to-date check
    <YYYY-MM-DD>/
      <HH-MM-SS>-<persona>/
        session.jsonl            # one event per step: url, thought, emotion, confusion, action
        shots/                   # step screenshots
        video.webm               # full browser recording (VP8 WebM)
        report.md                # verdict + drop-off analysis + timeline + confusion curve
        meta.json                # metadata for stages 2-3, incl. brain/model/effort
        FIXES.md                 # expert panel findings (after stage 3)
.clientsimulator-state.json  # doctor verification cache (gitignored)
.env                   # mail config (gitignored)
```

Session directories are found by walking `runs/` for any folder containing a
`meta.json`, so the nesting depth is not load-bearing — you can reorganise sites
into subfolders and stages 2-3 still find everything.

`video.webm` is VP8. QuickTime cannot play it; use a browser or VLC.

## Useful commands

```bash
client-simulator doctor      # verify environment
client-simulator mailtest    # mailbox create/receive/extract/destroy lifecycle test
npm run build          # compile (source is TypeScript in src/)
npm run typecheck      # tsc --noEmit
npm test               # compile + run the unit suite (no LLM calls, no network)
```

Tests live beside their source as `src/**/*.test.ts` and use Node's built-in
runner — no test framework dependency. They cover the pure logic that stages 1-3
depend on: run-directory layout and discovery (`runs.ts`), the stuck-loop
detector, JSON extraction from noisy CLI output, and video-clip selection.
Anything needing a brain or a browser is deliberately out of scope, so the suite
runs in well under a second.

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
4. Read `runs/<site>/AGGREGATE.md` before individual reports — verdict summary first, details second.
5. `FIXES.md` sections are independent per expert; cite evidence lines when discussing fixes.
6. Sessions are immutable artifacts — re-run `fix` with `--force` to regenerate advice, never re-visit to "fix" a report.
7. A GUARDRAIL verdict is still valid data: it means the site blocked the client (stuck loop, broken page, payment wall), not that the tool failed.
