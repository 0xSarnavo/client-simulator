# client-sim — Plan

Synthetic client agents that walk any website's onboarding like real humans: think out loud, get confused, walk out — and report where and why they dropped off.

## Architecture

```
persona presets (cold/warm/hot)  →  src/persona/presets.ts
CLI                              →  src/cli.ts
step loop + guardrails           →  src/session.ts
browser (Playwright, a11y "ai")  →  src/browser/driver.ts
brain adapters (claude/opencode) →  src/brain/adapters/  (persistent sessions)
prompt builder (tiered history)  →  src/brain/prompt.ts
JSONL log + markdown report      →  src/log/
```

## Memory model (3 layers)

1. **Native CLI session** — claude `--session-id <uuid>`, opencode `-s <ses_id>` parsed from `--print-logs`. Full verbatim recall within a run.
2. **Tiered prompt history** — last 5 steps detailed (thought/emotion/confusion/action), older steps one-line summaries. Rendered from the JSONL events each step.
3. **Failure hints** — failed Playwright action injected into next prompt with explicit "try a different approach" instruction.

## Reliability systems

- Goal verification: `complete` decisions are challenged via a strict follow-up call (`buildVerificationPrompt`); rejected claims keep the session going (max 2 verifications).
- Guardrails: identical-action stuck loop (3×), consecutive action failures (4×), patience cap, brain crash.
- Click fallback: scrollIntoView + retry before surfacing failure.
- Settling: domcontentloaded + networkidle + fixed delay after every action.

## Roadmap

### v0.2 — identity ✅ (shipped)
- Ephemeral mailboxes: alias minted per run (`cold.a1b2c3@domain`), messages purged on run end
- IMAP provider over any catch-all inbox (Cloudflare Routing → Gmail etc.), env-var configured
- `check_email` persona action: polls inbox, extracts OTP codes + magic links, feeds back as inbox content
- `otp_patience_seconds` persona field — waiting too long = in-character abandonment
- Video recording per session (`video.webm`)
- Stage architecture: visit / report / fix / all — gated, idempotent, --force override
- Expert panel: scores (conversion scorecard) + ux (prioritized fixes)
- Aggregate funnel report (runs/AGGREGATE.md)

### v0.2.x — COMPLETE
- ✅ Persona YAML files + AI persona generator (graph: core + nearest-neighbor, anti-similarity enforced)
- ✅ Experts: scores, ux, copywriter (rewrite tables), trust/security, accessibility — 5 total
- ✅ Doctor (deep env check, state-cached 7d, auto-runs on first visit)
- ✅ Interactive run planner (per-persona counts, max 10, random shuffle) + --runs N + AGENTS.md
- ✅ max_confusion_before_bail wired into persona prompt
- 🔲 First real OTP signup run (needs target site choice — everything else is built)

### v0.3 — deferred
Removed from plan. Will be re-scoped based on real usage after refinement:
possible topics were run matrix, returning-visitor memory, funnel clustering —
none are needed until the tool sees regular use.

### Expert panel (`client-sim fix <dir>`)
Decoupled from visits: sessions record; experts advise. Each expert is one file implementing:
```ts
interface Expert { id: string; title: string; run(ctx: ExpertContext, brain: Brain): Promise<string|null> }
```
Registered in `src/experts/index.ts`. Built-in: `scores`, `ux`, `copywriter`, `trust`, `a11y`.
- Panel runs merge into per-session FIXES.md with per-expert sections

### Later — memory provider interface (opt-in) — REMOVED from roadmap
Was: Supermemory-backed returning-visitor personas + semantic cross-run mining.
Cut during refinement. Revisit only if real usage demands it.
