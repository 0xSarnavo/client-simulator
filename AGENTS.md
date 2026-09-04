# AGENTS.md — client-simulator

Instructions for AI coding agents (and humans) operating **client-simulator**: a CLI that sends synthetic client personas through any website's onboarding. Personas think out loud, complete or abandon the flow like real users, and produce drop-off reports.

This is the single source for the repo. Three parts:

| | For | Read it when |
|---|---|---|
| **Part 1 — Operating the tool** | Running it | You want a report out of a website |
| **Part 2 — How the code works** | Changing it | You are about to edit `src/` |
| **Part 3 — Working agreements** | Both | Before your first change, once |

Also read **[DECISIONS.md](DECISIONS.md)** before proposing anything. Its
"Tried and rejected" table lists things that were built, measured and deleted —
it is there so you do not rebuild them.

---

# Part 1 — Operating the tool

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
client-simulator --doctor          # deep check incl. live brain call + mailbox test
client-simulator --doctor --force  # re-run even if recently verified
```

Results are cached in `.clientsimulator-state.json` (gitignored) for 7 days — checks don't re-run every time.

**Optional — email verification support (OTP/magic links):** create `.env` in the project root:

```
CLIENTSIM_IMAP_HOST="imap.gmail.com"
CLIENTSIM_IMAP_USER="you@gmail.com"
CLIENTSIM_IMAP_PASS="xxxx xxxx xxxx xxxx"   # Gmail app password
CLIENTSIM_MAIL_DOMAIN="yourdomain.com"      # domain with catch-all → your inbox
```

Requires a domain whose catch-all forwards to the IMAP inbox. Without it, personas treat "check your email" walls as drop-off points (still valid data). Test with `client-simulator --mailtest`.

## Choosing the AI (brain, model, effort)

Every stage that calls an AI — the site read, persona generation, the visits, the
expert panel, `--doctor` — resolves three things: which CLI plays the client,
which model, and how much reasoning effort. They are resolved once and reused for
the rest of the run. Pass them as flags or let it ask.

```bash
client-simulator <url>                                    # menus for all three
client-simulator <url> --brain claude                     # menus for model + effort only
client-simulator <url> --brain claude --model opus --effort high   # no menus
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
(what to do → url → how far to go → brain → model → effort → who visits).
`--help` still prints the flag reference. Ctrl-C out of any menu exits cleanly
with status 130.

## One command

```bash
client-simulator <url>                          # the lot
client-simulator firecrawl.dev --yes            # the lot, asking nothing
client-simulator firecrawl.dev --stop personas  # just read it and build prospects
```

Point it at a site and five stages run in order:

| Stage | Does | Writes |
|---|---|---|
| `site` | Scrapes the landing page: what it sells, to whom, its CTA, signup path, visible pricing, walls, what a first-timer trips on | `runs/<site>/SITE.md` |
| `personas` | Builds a prospect set fitted to that product, spread across core / adjacent / edge | `runs/<site>/personas/` |
| `visit` | One session per persona, all at once when several are queued — live thought stream (lines prefixed by persona id), ending COMPLETED / ABANDONED / GUARDRAIL | `session.jsonl`, `report.md`, `video.webm` |
| `report` | Aggregates the funnel across the site's sessions | `runs/<site>/AGGREGATE.md` |
| `fix` | Expert panel over each session | `FIXES.md` per session |

`--stop <stage>` ends after that one. `site` is written once per site and
`personas` is skipped when a set already exists — `--plan` redoes both. Re-running
a later stage with no new data is a no-op ("up to date"); `--force` regenerates
anyway.

**`site` and `personas` gate on nothing.** A site with no brief gets one whatever
flags were passed, including `--persona`. That ordering is the whole reason this
was reorganised — see [DECISIONS.md](DECISIONS.md), 2026-08-31.

**A persona only ever sees one viewport.** The snapshot is cut to what is on
screen, plus a headings outline of what lies below. On a 21-screen page that is
40 elements instead of 776. Scrolling is free — it does not spend patience.

### On its own

```bash
client-simulator --report [dirs...]     # aggregate past sessions
client-simulator --fix <dirs...>        # expert panel over past sessions
client-simulator --doctor               # verify the environment
client-simulator --list-personas        # every persona, built-in and custom
client-simulator --new-persona "Name"   # build one by answering questions
client-simulator --mailtest             # mailbox lifecycle test
```

Sessions are grouped by the URL recorded in each `meta.json`, not by where they
sit on disk, so a session moved between folders still lands in the right funnel.
The panel is gated on the aggregate for that session's own site.

The seven old subcommands (`visit`, `report`, `fix`, `all`, `doctor`, `personas`,
`mailtest`) still dispatch, unchanged. They are not in `--help` and are not the
documented surface.

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
| `expert` | `Read`, `WebFetch`, search | Experts read screenshots and fetch the page for raw HTML. No shell: their input is a transcript quoting the site under review, so it is attacker-influenced too, and `WebFetch` is the narrow tool for the one thing the prompts actually need |

Unused tool schemas cost roughly 5k tokens on every single call, so this is a
substantial saving as well as a correctness boundary.

## Personas

| Preset | Client | Behavior | Arrives knowing |
|---|---|---|---|
| `cold` | Skeptical Sam | First visit, low tech comfort, skims, distrusts forms/jargon, low patience | **nothing** |
| `warm` | Curious Chloe | Comparing options, wants pricing/features, tolerates minor friction | the arrival paragraph from `SITE.md` |
| `hot` | Ready Rahul | Decided to buy, goes straight to signup, bails only when truly blocked | that, plus what it does, costs, and how signup works |

That last column is `arrivalFor()` in `src/site/brief.ts`, and it is load-bearing.
The three temperatures are three amounts of prior research, which is most of what
makes them behave differently. Giving a cold persona any of the brief turns it
into a warm one, and whatever it then fails to notice stops being evidence about
the page. Giving a hot persona none of it produces a "decided buyer" who
rediscovers the pricing page, which no real hot prospect does.

Each persona has `otp_patience_seconds` — waiting too long for a verification email is in-character abandonment.

### Where personas come from

| Source | Path | Scope |
|---|---|---|
| Built-in presets | `src/persona/presets.ts` | everywhere |
| Yours | `personas/*.yaml` | everywhere |
| Generated for one site | `runs/<site>/personas/*.yaml` | that site only |

Most specific wins on an id collision. **`siteOwnPersonas()` reads only the third
row** — it decides whether generation runs and what an unattended run queues, so
defining it as "anything that is not a built-in" silently promotes your global
personas into every site's run. A set built for a scraping API is noise
when you test a checkout, which is why generated sets live beside their site's
runs rather than in the flat global directory.

### Custom personas (YAML)

```bash
client-simulator --list-personas               # list all (built-in, custom, per-site)
client-simulator --new-persona "My Persona"    # asks: scope, temperature, goal, traits
client-simulator <url> --stop personas         # AI-build a set for that site
```

#### Persona generator (AI-built persona sets)

```bash
client-simulator <url> --stop personas        # read the site, build a set, stop
client-simulator <url> --stop personas --plan # rebuild the set for a known site
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

Traits are the personality lever — write them like a character brief, first-person reactions the LLM should mimic. Invalid files are listed with reasons by `client-simulator --list-personas` and skipped (never crash runs).

## Safety

Personas may go anywhere, including pricing, billing docs and checkout pages —
reaching the wall is the finding. What is blocked is the *action*, not the page.

Enforced in `src/safety.ts`, before every action in `src/session.ts`. **This is
a best-effort label match, not a guarantee.** A label it has not seen — an
unusual phrasing, a language not listed below, a control with no accessible name
— will pass. Do not point this at a live commerce site and assume it cannot buy.

Every label is read several ways before it is judged, because the page chooses
its own spelling: accents folded, Latin lookalikes mapped in ("Googlе" with a
Cyrillic е), letter-spacing collapsed ("G o o g l e"). Every reading is checked
and any dangerous one blocks — injected text can add a label, never mask one.
That last part matters: a page can print "[ref=e12]" in its own copy, and taking
the first matching snapshot line let one hidden div relabel every control on the
page as "Continue".

- **Payment.** Card-number fields (by label), anything passing a Luhn check, and
  commit controls: "Pay", "Pay now", "Buy it now", "Place your order",
  "Complete your order", "Confirm & pay", PayPal/Apple Pay/Google Pay, "Donate",
  and a bare "Subscribe" (Stripe Checkout's literal commit button in
  subscription mode). "Upgrade" and "See pricing" pass — they open a checkout
  the persona should be able to reach and describe. Beyond English: es/pt/fr/de/
  it/nl commit phrasings ("Pagar", "Payer", "Kostenpflichtig bestellen",
  "Finalizar compra", "Valider la commande"), plus ru/ja/zh/ko ("Оплатить",
  "今すぐ購入", "立即购买", "결제하기"). Bare verbs count only as the WHOLE label,
  so "Métodos de pago" stays readable.
- **Meeting bookings.** The commit controls of schedulers: "Schedule Event"
  (Calendly), "Confirm meeting", "Book this slot", "Book now" — and a bare
  "Confirm"/"Schedule"/"Book" when the URL or page chrome says scheduler
  (cal.com, Calendly, timezone pickers). "Book a demo" and "Request access"
  stay clickable: they open the scheduler, and seeing that signup is
  demo-gated is the finding. Filling the form is looking; only the commit is
  refused. This guard exists because two sessions put real 20-minute meetings
  on a real founder's calendar.
- **Third-party auth.** "Sign in with X", bare provider-icon buttons whose whole
  label is "Google", "Use SSO", "Enterprise login", "Log in with your work
  account", and the same in other languages, verb-first or verb-last
  ("Continuar con Google", "Mit Google anmelden", "Googleでログイン").
  "Continue with email" is not SSO; neither is "Share via Slack".
- **Email is always the assigned mailbox** — invented addresses are overridden.

Page text reaches a model as data, never as instruction: the snapshot goes into
the persona and verification prompts with backticks stripped, so a page cannot
close the ```yaml fence around it, and the session transcript reaches the expert
panel inside an explicit untrusted-data block.

Two structural defences back the label matching: every session runs in a fresh
`browser.newContext()` (no saved cards, no logged-in provider), and `type` uses
`fill()` and never presses Enter (no implicit submit).

**There used to be a third, and it was not true.** This section claimed the
snapshot was main-frame only, so iframed Stripe/Adyen/Braintree card fields "cannot
be targeted at all". Measured on 2026-08-31: `ariaSnapshot` descends into **every**
frame, cross-origin included, and a `Card number` field inside one appears in the
snapshot with a targetable ref. The label guards do still refuse it — a framed
card field and a framed "Pay now" are both blocked, and a Luhn-passing string is
blocked whatever the field is called — but that is the regex working, not a
structural ceiling. Do not point this at a live commerce site believing the card
form is unreachable.

A refusal does not end the session. The persona is told why, and either routes
around it or walks out — which is the behaviour you want recorded.

Enforced via persona prompt only (strict, but not mechanical):
- Never deletes data or invites teammates

### Why this replaced the URL blocklist

The previous guard matched URL substrings and was wrong in both directions. It
killed two `deep-evaluator` sessions for opening `docs.modelcode.ai/support/billing-and-credits`
and `platform.experientiallabs.ai/docs/billing` — help articles, not payment
pages — while a checkout at a path without those words walked straight past it.
Judging the action instead of the address fixes both failure modes.

## Output layout

```
runs/
  <site>/                        # hostname, www. stripped (e.g. example.com)
    SITE.md                      # what the page sells, its walls, its tripwires
    personas/                    # the prospects generated for this product
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
client-simulator --doctor    # verify environment
client-simulator --mailtest  # mailbox create/receive/extract/destroy lifecycle test
npm run build                # compile — source is TypeScript in src/
```

Changing the code rather than running it? Build, typecheck and test commands are in
[Verifying a change](#verifying-a-change).

## Tips for agents operating this tool

1. Always run `client-simulator --doctor` first on a new machine.
2. Pass `--brain`, `--model`, and `--effort` explicitly — an agent has no TTY, so
   omitting them silently accepts defaults rather than prompting.
3. Prefer `--headless` in CI/automation; headed mode is better for watching behavior live.
4. Read `runs/<site>/AGGREGATE.md` before individual reports — verdict summary first, details second.
5. `FIXES.md` sections are independent per expert; cite evidence lines when discussing fixes.
6. Sessions are immutable artifacts — re-run `fix` with `--force` to regenerate advice, never re-visit to "fix" a report.
7. A GUARDRAIL verdict is still valid data: it means the site blocked the client (stuck loop, broken page, payment wall), not that the tool failed.

---

# Part 2 — How the code works

TypeScript in `src/`, compiled to `dist/` by `tsc`. No framework, five runtime
dependencies (`playwright`, `execa`, `imapflow`, `yaml`, `zod`). The bin is
`dist/cli.js`.

## Data flow

```
cli.ts  ──►  BrowserDriver + Brain + optional MailProvider
                    │
                    ▼
              runSession()  ──►  session.jsonl  +  shots/  +  video.webm
                    │
                    ▼
            generateReport()  ──►  report.md  +  meta.json
                    │
                    ▼
          generateAggregate()  ──►  runs/<site>/AGGREGATE.md
                    │
                    ▼
              expert panel   ──►  FIXES.md
```

Each arrow is a stage boundary and each artifact is the next stage's only input.
Stage 2 reads `meta.json` and `session.jsonl` off disk — it never sees a live
`Session` object. That is why a lost JSONL line is a lost finding.

## The session loop

`runSession()` in `src/session.ts:35`. One `for` over `persona.patience_steps`:

1. `driver.snapshot()` — accessibility YAML for the page **and all its frames**, the URL, `scrollY`, and where every ref sits relative to the viewport
2. `driver.screenshotPath(step)`
3. `brain.decide(ctx)` — the persona picks one action
4. `blockedAction()` — safety runs on the *decision*, before anything touches the page
5. act, then append the `StepEvent` to `session.jsonl` **at the end of the step**,
   so the email override and any action failure make it into the file

Four exits:

| Exit | Trigger |
|---|---|
| `completed` | `complete` action, then `verifyGoal()` agrees (`MAX_VERIFICATIONS = 2`) |
| `abandoned` | `abandon` action — the persona gives its reason |
| `guardrail` | `stuckPattern()` fires, the page becomes unreadable, or the brain fails |
| `guardrail` | patience runs out, or the wall-clock budget does (`--time`, default 20m — waiting on mail and `wait` actions is excluded, the same logic that made scrolling free) |

A persona claiming `complete` without verification does not end the session — the
loop `continue`s with a note, because personas are wrong about being done.

## Module map

| Path | Owns | Touch it when |
|---|---|---|
| `src/cli.ts` | Flag parsing, the wizard, `prepareSite`/`prepareSitePersonas`, and every stage wired end to end. The only file that knows about every other. | Adding a flag or changing the run order |
| `src/session.ts` | The step loop, exit conditions, `stuckPattern()`, inbox merging | Changing how a journey runs or ends |
| `src/types.ts` | `Persona`; the `Decision` / `StepEvent` / `Verdict` zod schemas; the `Brain` and `BrainContext` interfaces; `SAFETY_RULES` prompt text | Changing the decision contract |
| `src/safety.ts` | `blockedAction()` — label extraction, Luhn, payment and SSO matching | Adding or relaxing a guard |
| `src/runs.ts` | The `runs/` layout: `siteSlug()`, `sessionPath()`, `findSessionDirs()` | Changing where sessions land |
| `src/doctor.ts` | Environment verification and its 7-day state cache | Adding a preflight check |
| `src/browser/driver.ts` | Playwright wrapper: `snapshot()` and its per-ref visibility measurement, actions, screenshots, video, popup following, `needsKeystrokes()`, `chooseRecording()` | Anything the browser does |
| `src/browser/cursor.ts` | Injected pointer and click ripple for recordings | Changing what recordings show |
| `src/browser/prune.ts` | `pruneSnapshot()` machine-noise removal, and `splitByViewport()` — what a person can see vs an outline of what is below | Changing what the persona perceives of a page |
| `src/brain/index.ts` | `getBrain()` — name to adapter | Registering a brain |
| `src/brain/prompt.ts` | `buildPrompt()`, `fenceSafe()`, repair and verification prompts, history tiering | Changing what a persona sees |
| `src/brain/catalog.ts` | `BRAIN_SPECS`, live model and effort probing | Making a new brain appear in the picker |
| `src/brain/picker.ts` | Resolving brain/model/effort from flags or menus, and validating them | Adding a brain-related flag |
| `src/brain/roles.ts` | Per-role tool restrictions | Changing what a persona or expert may do |
| `src/brain/adapters/cli-brain.ts` | The shared CLI-spawn brain: retries, `spawnEnv()`, `extractJson()`, `MAX_DECIDE_ATTEMPTS` | Changing how any CLI brain is called |
| `src/brain/adapters/{claude,codex,opencode}.ts` | Per-CLI argv and sandbox flags | Adding or fixing one brain |
| `src/persona/load.ts` | YAML discovery and validation, the `personas/` + preset registry | Changing persona loading |
| `src/persona/presets.ts` | Built-in cold / warm / hot | Tuning a preset |
| `src/persona/generate.ts` | AI-built persona sets, the core/adjacent/edge spread | Changing generation |
| `src/mail/types.ts` | The `MailProvider` interface and `MailMessage` | Adding a mail provider |
| `src/mail/imap.ts` | `ImapProvider` — mailbox lifecycle, UID-addressed reads | Changing mailbox behaviour |
| `src/mail/mime.ts` | Part picking, base64 and quoted-printable decoding, code and link extraction | Changing OTP extraction |
| `src/site/brief.ts` | `runs/<site>/SITE.md`: writing it, and `arrivalFor()` / `icpSeed()` reading it back | Changing what a site read produces, or who sees it |
| `src/site/flow.ts` | `runs/<site>/FLOW.md`: drafting checkpoints from an intent, and `scoreFlow()` judging a finished session against them | Changing what a flow is or how sessions are scored |
| `src/log/report.ts` | Per-session `report.md` and its timing | Changing a session report |
| `src/log/aggregate.ts` | `loadSessions()` (zod-validated) and `generateAggregate()` | Changing the funnel |
| `src/experts/index.ts` | The `EXPERTS` registry | Registering an expert |
| `src/experts/{ux,copywriter,reviewers,discoverability,scores}.ts` | One expert each, plus its renderer | Changing panel output |
| `src/ui/prompt.ts` | Zero-dependency `select` / `multiselect` / `text` over a raw-mode TTY | Adding a menu |

## Invariants and tripwires

Seventeen things that will bite you. Most were paid for once already — see
[DECISIONS.md](DECISIONS.md).

1. **`dist/` is build output.** Never edit it. `npm test` runs `tsc` first and then
   `dist/**/*.test.js`, so an unbuilt change tests green against stale code.
2. **Site text is untrusted input.** Any new path that quotes page text goes through
   `fenceSafe()` (`src/brain/prompt.ts:40`) and `pruneSnapshot()`. A page that prints
   ` ``` ` will otherwise close the fence and have the rest read as instruction.
3. **Shape the page in `buildPrompt`, never in `driver.snapshot()`.** The driver
   *measures* (visibility, `scrollY`); `pruneSnapshot` and `splitByViewport`
   *decide what is shown*, at prompt time. `verifyGoal` reads the full
   `ariaYaml`, or a confirmation scrolled out of view becomes a false drop-off.
4. **Sessions are immutable artifacts.** Regenerate with `--force`. Never re-visit
   a site to "fix" a bad report.
5. **The three structural defences under [Safety](#safety) carry more weight than
   the label regexes do.** They read as incidental in the driver. Breaking one
   quietly removes the real ceiling on what a persona can do to a live site.
6. **Short-maxlength fields need real keystrokes.** `needsKeystrokes()`
   (`src/browser/driver.ts:21`) — `fill()` puts the whole string in a six-box OTP
   input and only the first digit survives.
7. **`extendEnv: false` is mandatory** when spawning a brain. execa v9 silently
   re-merges the parent env without it, and `spawnEnv()`'s allowlist stops meaning
   anything.
8. **IMAP is addressed by UID everywhere.** Mixing in sequence numbers gives you
   correct envelopes with empty bodies — and, in `destroy()`, trashes unrelated mail.
9. **Validate a new flag in `src/brain/picker.ts`.** Unvalidated, it fails *after*
   launching a browser and minting a mailbox.
10. **Nothing gates the site brief.** `prepareSite()` runs before the queue is
    resolved, on purpose. Putting it behind a flag check is the bug that made
    `--persona cold` send an uninformed persona into an unread site.
11. **`arrivalFor()` decides who sees the brief, and cold sees none of it.** If you
    add a consumer, ration it there — not by reading `SITE.md` directly.
12. **A persona only ever sees one viewport, and `act()` enforces it.** 776 refs
    on firecrawl.dev against 37 a visitor could see. `requireOnScreen()` refuses a
    target that was not visible — without it `aria-ref=` resolves against the whole
    document and the limit is only a suggestion.
13. **Scrolling is free and must stay free.** It does not spend `patience_steps`,
    and its stuck-loop signature carries `scrollY`. Charging for it, or dropping
    the position, makes every long page guardrail while scrolling. The step
    counter prints `spent`, not the raw step, which now runs past the budget.
14. **A ref may carry a frame prefix — `f5e27`, not `e27`.** Match
    `REF_ID_PATTERN` from `prune.ts`, never a bare `e\d+`. Signup forms are
    routinely iframed, and on a page with both kinds the narrow pattern drops
    every control inside the form.
15. **Always resolve a persona with its site: `getPersonaRegistry(url)`.** Without
    it, personas generated into `runs/<site>/personas/` are missing and the
    `?? PERSONAS.cold` fallback silently reviews the run as somebody else.
16. **Queued personas run concurrently, so nothing may be shared across them.**
    Each gets its own brain, browser, `ImapProvider` and directory — an IMAP
    connection is stateful, and concurrent polls through a shared one interleave
    on a single socket. Session dirs are minted serially before launch because
    `sessionPath()`'s same-second suffix check is exists-then-create.
17. **Reports say risk, not measurement.** A simulated prospect stalling is a
    signal that real visitors could; render it that way ("people may stall
    here"), never as observed traffic. The framing lives in the renderers and
    the expert prompts — the exit kinds on disk are unchanged, so old sessions
    stay readable.

## Where to add things

- **A persona** — drop YAML in `personas/`, or add a preset in `src/persona/presets.ts`
- **An expert** — implement `Expert` in `src/experts/`, register in `src/experts/index.ts`
- **A brain** — adapter in `src/brain/adapters/` (build on `makeCliBrain`), wire into
  `src/brain/index.ts`, and add a `BrainSpec` to `src/brain/catalog.ts` or it will not
  show up in the picker
- **A mail provider** — implement `MailProvider` from `src/mail/types.ts`
- **A menu** — `select` / `multiselect` / `text` from `src/ui/prompt.ts`. They return
  silent defaults when there is no TTY, so nothing hangs in CI
- **A step-level action** — extend the `Decision` union in `src/types.ts`, handle it in
  the loop, and decide what `blockedAction()` should say about it

## Verifying a change

```bash
npm run typecheck    # tsc --noEmit
npm test             # tsc, then node --test dist/**/*.test.js

node scripts/verify-frames.mjs   # iframe measurement, needs a build + Chromium
```

`verify-frames.mjs` is deliberately outside `npm test`: it launches Chromium and
serves its own page. Run it after touching `measure()`, `splitByViewport()`, or any
ref pattern — a live site is not a reliable way to reproduce framed refs.

Tests sit beside their source as `src/**/*.test.ts` on Node's built-in runner — no
test framework. They cover the pure logic every stage depends on: run-directory
layout and discovery, the stuck-loop detector, JSON extraction from noisy CLI output,
video-clip selection, MIME decoding, expert rendering, persona loading, prompt
building, aggregation.

**What they deliberately do not cover: brains, browsers, network.** The suite runs in
well under a second and a green run is not end-to-end proof. For anything touching
the loop, the driver or a prompt, do a real run:

```bash
client-simulator <url> --persona cold --brain claude --headless --stop visit
```

---

# Part 3 — Working agreements

## Skills

| Situation | Skill | Who turns it on |
|---|---|---|
| Any code change in this repo | `ponytail` | the model, by default |
| README, AGENTS, DECISIONS, commit bodies, website copy | `no-ai-slop` | the model |
| Output should cost fewer tokens | `caveman` | either |
| Output should lead with the next action, number the steps, and restate state each turn | `i-have-adhd` | **you only** — the skill blocks model invocation, so type `/i-have-adhd` |

`ponytail` as the default describes this repo rather than adding a rule to it.
`810cf44` shipped a call budget with no new flag because the ceiling already existed
structurally. `e5d15ce` deleted two working optimisations for carrying real risk at
~0% benefit. That is already the house style.

## Precedence, when more than one is on

They conflict by construction — `caveman` compresses, `i-have-adhd` expands into
numbered structure. Resolve in this order:

1. **Correctness beats brevity.** Never drop a command, path, flag, or error string
   to save tokens.
2. **`i-have-adhd` wins on structure, `caveman` wins on wording.** Keep the numbered
   steps and the next-action-first opening; compress the words inside them.
3. **`caveman` shapes chat only, never file contents.** Anything committed stays full
   English under `no-ai-slop`.
4. **`ponytail` governs the code; `no-ai-slop` governs the writing about it.** Neither
   one gets a say in the other's territory.

## The decisions log

[DECISIONS.md](DECISIONS.md) is where the *why* lives. Read it before proposing;
append to it when you decide.

**Append an entry** when a session rejected an alternative, hit a constraint that
shaped the design, or reversed an earlier decision. Nothing for mechanical work — if
you cannot fill in **Why**, there is no entry to write.

**When you reject something after actually trying it, add a row to "Tried and
rejected" too.** That table is the reason a fresh agent does not spend an afternoon
rebuilding the URL blocklist.

The format is at the top of the file. Newest first.
