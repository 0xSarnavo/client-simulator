# OSS / platform evaluation — Aug 2026

Eight candidates evaluated for use as **dependencies** in new tools under `~/Development/workflows/`.
Verdict column answers one question: *can I actually build on this today?*

| # | Thing | Verdict | Why |
|---|---|---|---|
| 1 | Scrapling | **Use** | BSD-3, pip, library + CLI + MCP. Best-in-class. |
| 2 | Scout | **Use (vendor)** | MIT, clean importable modules, but no packaging. |
| 3 | herdr | **Use** | Apache-2.0, one binary, CLI + socket API, agent skill shipped. |
| 4 | supermemory | **Use** | Cloud API *or* free self-hosted single binary. |
| 5 | Experiential Labs | **Use, narrowly** | Model gateway. Real caveats — see below. |
| 6 | Linear | **Integrate, don't depend** | Target surface (Agent Session API), not a library. |
| 7 | Amulet | **Blocked** | Private beta, YC S26, two people. Site 403s. |
| 8 | Modelcode / Morph | **Reference only** | No public CLI or API. Closed web product. |

---

## 1. Scrapling — `pip install scrapling`

BSD-3. Python 3.10+. Adaptive web scraping framework.

**Three fetchers, escalating cost:**
```python
from scrapling.fetchers import Fetcher, StealthyFetcher, DynamicFetcher

Fetcher.get(url)                    # HTTP + TLS fingerprint spoofing (impersonate='chrome')
StealthyFetcher.fetch(url)          # browser + Cloudflare Turnstile solving
DynamicFetcher.fetch(url)           # full Playwright/Chromium, cdp_url for remote
```

Session variants (`FetcherSession`, `StealthySession`, `DynamicSession`) hold cookies.
`StealthySession(headless=True, solve_cloudflare=True)`.

**Parsing** — CSS, XPath, and BeautifulSoup-style in one object, plus structural navigation:
```python
page.css('.quote .text::text').getall()
page.xpath('//div[@class="quote"]')
page.find_all('div', class_='quote')
page.find_by_text('quote', tag='div')
el.next_sibling / el.parent / el.find_similar() / el.below_elements()
```

**The differentiator — adaptive selectors:**
```python
page.css('.product', auto_save=True)   # fingerprint the element
page.css('.product', adaptive=True)    # relocate it after the site redesigns
```
This is the feature nothing else on the list has. Scrapers stop silently rotting.

**Spiders** — concurrent crawl with pause/resume (`crawldir=`), AutoThrottle, robots.txt,
blocked-request detection, streaming (`async for item in spider.stream()`).
Templates: `CrawlSpider`, `SitemapSpider`, `XMLFeedSpider`, `CSVFeedSpider`, `ShopifySpider`.
Multi-session routing — cheap HTTP for open pages, stealth browser only for protected ones:
```python
def configure_sessions(self, manager):
    manager.add("fast", FetcherSession(impersonate="chrome"))
    manager.add("stealth", AsyncStealthySession(headless=True), lazy=True)
# then: yield Request(link, sid="stealth")
```

**CLI** — no code needed:
```bash
scrapling extract get 'https://x.com' out.md --css-selector '#main' --impersonate chrome
scrapling extract stealthy-fetch 'https://x.com' out.html --solve-cloudflare
scrapling shell    # IPython
```
Output format inferred from extension: `.txt` / `.md` / `.html`. `.md` is RAG-ready.

**MCP server** — `pip install "scrapling[ai]"`. Exposes HTTP fetch, browser fetch, stealth fetch,
CSS narrowing, screenshots, remote CDP. **Pages are sanitised before reaching the model to blunt
prompt injection** — that matters if an agent is scraping adversarial pages.

Claim: 92% test coverage, full type hints, faster parser than Parsel/PyQuery/Selectolax/BS4.

---

## 2. Scout — `github.com/kiryano/Scout`

MIT. Python 3.10+. 3,355 LOC total. Lead gen for appointment setters.

**Critical structural fact:** `scout.py` is 1,139 lines and almost all of it is Rich TUI —
menus, gradients, ASCII logo, an update-checker with *version enforcement*.
**All reusable logic lives in `app/scrapers/`.** Import that, ignore `scout.py` entirely.

```python
from app.scrapers import (
    scrape_instagram, scrape_tiktok, scrape_linkedin, scrape_github,
    scrape_youtube, scrape_twitch, scrape_linktree, scrape_linkbio, scrape_pinterest,
)
from app.scrapers.enrichment import LeadEnricher, enrich_lead
```

Every scraper returns the same flat dict shape:
```python
{'username','full_name','bio','follower_count','following_count','post_count',
 'is_verified','is_private','is_business','website','email','phone',
 'platform','profile_url'}
```

**`LeadEnricher` is the valuable part** (584 lines). `enrich_lead(dict) -> dict`,
`enrich_bulk(leads, max_workers=3)`. Pipeline:
bio regex → deep-scrape site + `/contact` + `/about` → company from headline ("CEO at X")
→ domain via DNS MX → detect existing email pattern → generate candidates
→ **SMTP-verify each** → score.

Confidence scoring is source-weighted, and the `accept_all` penalty is the honest touch:
```
bio 90 · hunter.io 80 · website 70 · smtp_guess 70 · bio_link 65 · contact_page 60 · pattern 40
+10 if SMTP says the mailbox exists
-20 if the server is catch-all (accept_all)
```
Has a blacklist for junk domains (`sentry.io`, `wixpress.com`, `schema.org`, gravatar…) and
skips "useless" websites (links pointing back to instagram/linktree/spotify).

**Auth needs:** LinkedIn only, via `li_at` session cookie (expires). Everything else is anonymous.
GitHub is capped at 60 req/hr untokened.

**Deps are light:** `requests, httpx, dnspython, free-proxy, rich`.

**Blockers to using it:**
- No `pyproject.toml` / `setup.py` → **not pip-installable.** Vendor it or git-submodule it.
- Imports are absolute (`from app.scrapers.stealth import ...`) → the `app/` package root must be
  on `sys.path`. Vendoring means keeping that directory name or rewriting imports.
- `scout.py` has an auto-update checker with version enforcement. Don't run `scout.py`; import around it.
- Author's own limitations list: IG needs retries by region, TikTok serves CAPTCHAs,
  SMTP verification is blocked by many mail servers, free proxies are unreliable.

**Overlap warning:** this is the same problem space as your existing `signal-lead-gen`.

---

## 3. herdr — `brew install herdr`

Apache-2.0. Rust, one binary, v0.8.2. YC-backed. macOS/Linux/Windows.
Terminal multiplexer built for coding agents. Owns their terminals; doesn't wrap them.

**Concept model:** Session → Workspace → Tab → Pane → Agent.
Agent lifecycle states: `working` · `blocked` · `done` · `idle` · `unknown`.
`blocked` = herdr recognised an approval/question UI on screen. That's the whole point —
you can programmatically detect an agent stuck waiting for input.

**Socket API** — newline-delimited JSON over a Unix socket. *Not* JSON-RPC.
Path: `~/.config/herdr/herdr.sock` (named sessions get their own).
**No authentication** — security is Unix socket file permissions only.

```json
{"id":"req_1","method":"ping","params":{}}
{"id":"req_1","result":{"type":"pong"}}
{"id":"req_1","error":{"code":"not_found","message":"pane not found"}}
```

Methods worth knowing:
`agent.start` `agent.prompt` `agent.wait` `agent.read` `agent.send_keys`
`pane.split` `pane.run` `pane.wait_for_output` `pane.read`
`workspace.create` `layout.export` `layout.apply`
`worktree.create` `worktree.open` `worktree.remove`
`events.subscribe` (long-lived push stream) `events.wait` (one-shot)
`notification.show` `session.snapshot`

Schema is self-documenting: `herdr api schema --json`.

**CLI equivalent** (what an agent inside a pane uses):
```bash
herdr pane split --current --direction right --cwd "$PWD" --no-focus
herdr agent start reviewer --kind codex --pane <id>
herdr agent prompt reviewer "..." --wait --timeout 120000
herdr agent wait reviewer --until blocked --timeout 120000
herdr agent read reviewer --source recent-unwrapped --lines 120
herdr pane run <id> "just test"
herdr pane wait-output <id> --match "test result" --timeout 120000
```

**Env injected into every managed pane:**
`HERDR_ENV=1`, `HERDR_SOCKET_PATH`, `HERDR_WORKSPACE_ID`, `HERDR_TAB_ID`, `HERDR_PANE_ID`.
IDs are opaque and stable (`w1`, `w1:t1`, `w1:p1`) and closed IDs are never reused.

**Ships its own Claude skill:** `skills/herdr/SKILL.md` —
`npx skills add herdrdev/herdr --skill herdr -g`.

**Gotchas from their own docs:**
- `agent start` needs an *already existing* shell pane at an interactive prompt. It never creates layout.
- Agent names must match `[a-z][a-z0-9_-]{0,31}` and be unique among live agents.
- `agent prompt` refuses (`agent_blocked`) if the agent sits at an approval dialog.
- A prompt that produces no lifecycle change in 5s returns `agent_prompt_stalled`.
- Agents on the terminal **alternate screen** can't be scrollback-read. Documented fallback:
  ask the agent to write Markdown to a temp file and reply with only the path.
- `unknown` state does *not* mean done.

**Why this matters here:** `client-sim` already shells out to `claude` / `opencode` / `codex`.
herdr is the natural substrate for running many of those concurrently, unattended, survivable.

---

## 4. supermemory

Memory/context layer for agents. Two deployment paths, and the free one is genuinely good.

**Self-hosted** — open source, repo at `git.new/memory` (exact license not stated in docs):
```bash
curl -fsSL https://supermemory.ai/install | bash    # or: npx supermemory local
```
One binary. No Docker, no DB provisioning, no config file. Generates its own API key on first boot.
Local embeddings by default (`Xenova/bge-base-en-v1.5`, 768d) — **no API key required**.
Serves the same API on `http://localhost:6767`. Fully offline-capable with Ollama.

**Cloud** — `https://api.supermemory.ai`, `Authorization: Bearer sm_...`
```
POST /v3/documents        ingest
GET  /v3/documents/{id}   status
POST /v4/search           semantic recall
POST /v4/profile          static + dynamic facts per container
```
SDKs: `npm install supermemory` / `pip install supermemory`. OpenAPI at `/v3/openapi`.

**containerTags** are the isolation boundary — partition memories by user, project, run, whatever.
For our purposes: one container per site under test, or per lead campaign.

**Cloud-only features** (the reason to pay): connectors (Drive, Notion, Gmail, OneDrive),
the hosted MCP server, and "proprietary long-horizon models" for memory extraction.
Self-hosted extraction quality is whatever model you point it at.

**Pricing:** Free $0 (~$5 credits) · Pro $19/mo ($20) · Scale $399/mo ($600) · Enterprise custom.
Metering: text $0.005/1k tokens, rich $0.01/1k, SuperRAG text $0.001/1k, search $0.005/1k queries,
operations $0.10/1k. **Diff billing** — re-ingesting under the same `customId` charges only the delta,
so re-syncing a document or conversation history is close to free.

**Recommendation: start self-hosted.** Zero cost, no key, same SDK, and migrating to cloud is a
`baseURL` change.

---

## 5. Experiential Labs

OpenAI-compatible model gateway. `https://api.experientiallabs.ai/v1`.
Keys are `xpl_` + 40 hex, scoped to one org. One header: `Authorization: Bearer <key>`.

**Provider waterfall** — each model has an ordered list of access paths; capacity or transport
errors fail over to the next automatically and invisibly.

**Three wire protocols on one gateway:**
```
POST /v1/chat/completions   OpenAI Chat Completions
POST /v1/responses          OpenAI Responses
POST /v1/messages           Anthropic Messages (translated onto the chat surface)
GET  /v1/models             callable models (auth)
GET  /api/models            public catalog + pricing (keyless)
```

**Two payment lanes:** BYOK pass-through (your provider keys, provider bills you, no markup)
or platform credits at public catalog rates. No markup either way.

Providers: OpenAI, Anthropic, Gemini, Azure OpenAI, OpenRouter, Bedrock, Fireworks, Modal,
Local, Experiential Cloud.

**Claude Code config:**
```bash
export ANTHROPIC_BASE_URL="https://api.experientiallabs.ai"   # no /v1 — CC appends it
export ANTHROPIC_AUTH_TOKEN="xpl_..."
export ANTHROPIC_MODEL="claude-opus-5"
```

**⚠️ Caveats that matter for `client-sim` specifically:**
- **Extended thinking configuration and history blocks are rejected** — they can't be preserved
  across the translation. `client-sim`'s `--effort high` flag is exactly this. It would break.
- **Images and documents are rejected** — text-only lane. `client-sim` feeds accessibility
  snapshots (text), so this is survivable, but any screenshot-to-model idea is out.
- `/v1/messages/count_tokens` returns 404.

Also note the philosophical conflict: `client-sim`'s README sells "Runs on AI CLI subscriptions.
No API keys. No per-run fees." A gateway is the opposite bet. Treat it as an **optional overflow
brain** for when subscription rate limits bite, not as the default.

---

## 6. Linear

Not a dependency — an integration target. GraphQL API + TypeScript SDK + webhooks.
OAuth 2.0 or personal API keys.

**Agent Session API** is the interesting part:
- Agents behave like users: @mentionable, assignable, comment, join projects/documents.
- **Agents don't consume a billable seat.** Building internal agents is free.
- Install with `actor=app` (supersedes `actor=application`) — requires admin approval.
  Scopes: `app:assignable`, `app:mentionable`, plus `customer:*` / `initiative:*`.
  An `actor=app` app **cannot** request `admin` scope.
- A session is created automatically on mention or delegation. State updates from emitted activities.
- **The agent must emit a `thought` activity within 10 seconds** of session creation or the user
  is left staring at nothing. Hard latency budget.
- `promptContext` carries issue details, comments, guidance.
- Get your per-workspace app id with `query Me { viewer { id } }` and store it beside the token.

Their published agent-interaction design principles are worth stealing wholesale for any agent
we build, Linear or not: acknowledge fast, look native, stay transparent, respect permission changes.

---

## 7. Amulet — **blocked**

High-performance filesystem for parallel AI workloads. YC S26, two people.
Workspaces mount in <100ms regardless of size, fork in milliseconds copying zero bytes,
versioned history, snapshot/reproduce/merge/rollback. Agents and humans share one live workspace.

**Why we can't use it:** private beta, approving partners in small batches.
The site 403s on programmatic fetch. Published pricing, no customer logos, benchmarks are internal
and not third-party validated.

**What to do instead:** herdr's `worktree.create` covers the same "isolated parallel workspace"
need for our scale using plain git worktrees. Revisit Amulet if we ever hit real petabyte parallelism.
Open-source alternatives in the same space if it becomes urgent: `tursodatabase/agentfs`,
`neul-labs/agentvfs`.

## 8. Modelcode / Morph — **reference only**

AI for large-scale code modernization: language upgrades (COBOL→Java, Ada→C++, Py2→3),
framework migrations (AngularJS→React, Express→FastAPI), monolith→microservices.

Workflow: define goals → configure build env → analyse codebase → **human approves a Project Spec**
→ execute as phased milestones delivered as PRs → user merges.
Features: custom rules encoded across all milestones, multi-repo with per-repo roles
(Modified / New / Reference Only / One-to-One), functional verification of behavioural parity,
acceptance criteria that must pass before merge, ModelDaemon for self-hosted execution with no
inbound access.

Pricing: 40,000 credits/mo free, then $0.01/credit. Zero per-seat, unlimited projects and LOC.

**No public CLI, API, or MCP.** Docs at `docs.modelcode.ai`. Web product only, plus the enterprise
daemon.

**The idea worth stealing:** *human approves a spec before any code is generated, then work lands
as reviewable milestone-sized PRs with acceptance criteria attached.* That gate is the whole
product and it costs nothing to copy.

---

## Cross-cutting read

The genuinely reusable ideas across all eight, independent of whether we adopt the tool:

1. **herdr's `blocked` state.** Detecting "this agent is stuck waiting for a human" is the hard part
   of unattended agent work, and it's solved.
2. **Scrapling's adaptive selectors.** Scrapers that repair themselves instead of failing silently.
3. **Scout's source-weighted confidence with a negative signal.** The `accept_all → -20` penalty is
   what separates a real scoring model from a vibes number.
4. **Linear's 10-second acknowledgement rule.** A hard latency budget on "I heard you."
5. **Modelcode's spec-approval gate.** Nothing executes until a human signs the plan.
6. **supermemory's diff billing / `customId`.** Idempotent re-ingest is the right shape for any
   incremental sync.
