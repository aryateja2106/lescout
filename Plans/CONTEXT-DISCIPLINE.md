# Context Discipline & Solo Founder UX

**Status:** Design doc — 2026-05-15
**Owner:** Arya
**Parent PRD:** `Plans/PRD-v1.md`

## 1. The 100K rule

Every modern coding agent (Claude Opus, GPT-5, Gemini 3) ships with ≥100K
context. **Treat 100K as a hard budget.** Beyond that, retrieval beats
re-injection. Tasks requiring more than 100K must chunk, process each
chunk with a fresh agent, and reconcile with a reviewing agent.

### Failure mode LeScout exists to fix

> *"It's often better to just open a new Claude Code chat and give the
>  same task. If instead of that I just ask it to explore the old chat
>  or even provide the chat id and if it can quickly go through what
>  tasks we were working on, with working context and bring the high
>  level parts, the agent can easily pick up where its left."*
>
> — Arya, 2026-05-15

The fix is **session-resume by chat-id** + **brain-backed retrieval**
+ **scheduled compaction**. Built today as `lescout session resume <id>`.

## 2. Eight requirements captured this session

| #  | Requirement | Owner | Phase |
|----|-------------|-------|-------|
| R1 | Solo-founder positioning, "1 person + agents handling entire business" | brand + PRD | 1 |
| R2 | Two-format storage: markdown (human-readable) + HTML (visual fidelity) | scout-core | 2 |
| R3 | Privacy redaction at ingest (API keys, secrets, PII) | scout-core/redact | 2 |
| R4 | 100K context budget enforcement (hook-driven compaction) | hooks | 3 |
| R5 | Background workers (cron) — relate, surface recent | scheduler | 3 |
| R6 | Session-resume from chat-id | scout-core/session | **✓ Phase 1.5** |
| R7 | Multi-agent 24/7 query layer (small workers reading brain) | mcp-adapter | 3 |
| R8 | Coexist with agentmemory + GBrain, don't fork | adapter | 2 |

## 3. Solo founder positioning

LeScout is not "another agent platform." It's the **infrastructure a
solo founder uses to multiply themselves**: one person + a fleet of
agents handling multiple companies, with shared knowledge that
compounds daily.

Target user mental model:

```
                  ┌─────────────────────────────────────────┐
                  │     ONE FOUNDER + LeScout brain         │
                  │  (Mac + Pi-5 always-on + VPS clients)   │
                  └────┬──────┬──────┬──────┬──────────────┘
                       ▼      ▼      ▼      ▼
                   Company  Company  Side   Personal
                     A        B     Project  Brand
                   (LeSearch) (CloudAGI) (nl2shell) (aryateja.com)

  Each project has its own scoped brain workspace.
  All scoped brains roll up into a "founder brain".
  Worker agents query the relevant scope.
  Founder queries across all.
```

This maps directly onto Tom Blomfield's Company Brain RFS, but starts
from the **solo-founder primitive first**. Once it works for one
person across companies, the same engine extends to teams.

## 4. R6 — session-resume (built today)

### CLI
```
lescout session list [--limit N] [--project SUBSTR]
lescout session show <chat-id>      # print summary
lescout session resume <chat-id>    # write summary to brain
```

### Slug shape
```
sessions/<flat-project>/<YYYY-MM-DD>-<short-id>
```
Two slashes only — gbrain rejects deeper. Project name is flattened
(`-` and `/` → `_`, lowercased, ≤60 chars).

### What gets extracted
- Original task (first user message, ≤1500 chars)
- All user follow-ups (one-line each)
- Last assistant response tail (≤2000 chars — usually contains the
  delivered work / final state)
- Tool counts (`Bash: 25, Edit: 3, …`)
- Files touched (Write/Edit/MultiEdit targets, sorted by frequency)
- Duration, turn counts, timestamps

### How to use it (the killer flow)

```
# In an old session you walked away from:
$ lescout session list --project mconnect --limit 5
SHORT     DATE        LINES   PROJECT             TITLE
c3e84358  2026-05-14  120     Projects/mconnect   Fix OAuth flow

# Save it to the brain:
$ lescout session resume c3e84358
✓ wrote sessions/projects_mconnect-prototype/2026-05-14-c3e84358

# Open a fresh Claude Code chat anywhere on your machines:
> "Resume session c3e84358. What were we doing?"

# Claude uses the gbrain MCP to fetch the page, summarizes back to
# you in 200 tokens, and is ready to continue.
```

## 5. R4 — 100K budget enforcement (Phase 3 design)

### Hook design (Claude Code)

```
hooks/PreToolUse.hook.ts    → check token usage. If >70K, warn.
hooks/PostToolUse.hook.ts   → if context >85K, suggest compact.
hooks/Stop.hook.ts          → auto-write `lescout session resume` for
                              the current chat-id on graceful end.
hooks/SessionEnd.hook.ts    → same, plus mark page tag=archived.
hooks/PreCompact.hook.ts    → before Claude compacts, snapshot to brain
                              (so we never lose detail when compaction
                              runs).
```

### pi-side equivalent

`~/.pi/agent/extensions/lescout-budget.ts` — a tool-call middleware
that estimates token usage and emits warnings + auto-checkpoints.

### Auto-chunk policy (>100K tasks)

```
1. Detect: estimated input + tool-output > 100K
2. Plan-fork: spawn sub-pi to draft chunk plan (planner role)
3. Execute: each chunk runs in a fresh sub-pi with the chunk plan only
4. Review: reviewer sub-pi reads all chunk outputs + original goal,
          produces verdict + diff/PR
5. Merge: orchestrator commits or asks user to review
```

This already partially exists in pi via the `subagent` tool. LeScout
adds the **token-aware trigger**: not "should I delegate?" but
"I will exceed budget if I keep this in one context — delegating now."

## 6. R5 — Background workers (Phase 3 design)

### Cron schedule

```
*/15 * * * *   lescout sweep --recent     # catch new sessions, scout new repos
0 */1 * * *    lescout link --auto        # build typed edges between pages
0 3 * * *      lescout compact --stale    # compress >7d untouched pages
0 4 * * *      lescout export --vault     # write brain → ~/Documents/SecondBrain
0 5 * * 0      lescout review --week      # weekly digest into brain
```

### Workers run on Pi-5 (Phase 5 deployment)

Each worker is a Bun script in `packages/scout-cron/`. Logs to
`~/.lescout/cron/<worker>/<date>.jsonl`. Failures notify via gbrain
page `ops/cron-failures/<date>` so the next session inherits awareness.

## 7. R7 — Multi-agent 24/7 query layer

Small worker agents (codex/cursor sub-runs, pi workers) need:

- **Cheap fast lookups** — they shouldn't burn 8K tokens per query
- **Deterministic results** — same query, same answer
- **Failure-aware** — if brain is down, fall back to file grep

This means the MCP adapter must expose a **slim retrieval surface**:

```
lescout-mcp tools:
  brain.recall(query, limit=5, scope=default)    → top-K passages
  brain.entity(slug)                              → one page
  brain.list(prefix, limit=20)                    → slugs by prefix
  scout.repo(url)                                 → ingest a repo (sandbox)
  scout.url(url)                                  → ingest a URL (sandbox)
  session.resume(chat_id)                         → load prior chat state
```

Six tools max. Anything more confuses small models.

## 8. R8 — agentmemory + GBrain coexistence

**Decision:** keep both, different roles. Don't migrate.

| Tool | Role | When it writes |
|------|------|----------------|
| **agentmemory** (when installed) | Passive auto-capture of every tool call. 4-tier consolidation. Real-time viewer. Session replay. | PostToolUse hook |
| **GBrain** (now) | Explicit knowledge writes. Scout-ingested pages. Session summaries. Typed entity graph. | Explicit `gbrain put` |
| **LeScout** | The composer. Sandbox + adapters. Owns sandbox-safety, solo-founder UX, cron workers, multi-machine deploy. | n/a — orchestrates |

LeScout becomes the **brand and harness** that wraps both.
Phase 4 (LeScout native brain) is a *fallback option* if upstream
GBrain/agentmemory diverge from our needs. Don't build until needed.

## 9. R2/R3 — Two-format ingest + redaction (Phase 2 design)

### Per-URL ingestion

`lescout grok <url>` inside the sandbox container:

```
1. curl URL → /work/raw.html
2. trafilatura → /work/clean.md    (text for the brain)
3. wkhtmltopdf or shot-scraper → /work/page.png (visual snapshot, optional)
4. Original /work/raw.html stays as artifact

Outputs to host:
  ~/.lescout/artifacts/<doc_id>/clean.md        # markdown (goes to brain)
  ~/.lescout/artifacts/<doc_id>/raw.html        # original (browsable locally)
  ~/.lescout/artifacts/<doc_id>/page.png        # visual snapshot (optional)
  ~/.lescout/artifacts/<doc_id>/meta.json       # url, fetched_at, sha256
```

### Redaction pass (between extract and brain write)

```
const REDACTORS = [
  /sk-ant-[a-zA-Z0-9_-]{20,}/g,           → "[REDACTED:anthropic-key]"
  /sk-[a-zA-Z0-9]{20,}/g,                 → "[REDACTED:openai-key]"
  /AIza[a-zA-Z0-9_-]{20,}/g,              → "[REDACTED:google-key]"
  /ghp_[a-zA-Z0-9]{20,}/g,                → "[REDACTED:github-pat]"
  /github_pat_[a-zA-Z0-9_]{20,}/g,        → "[REDACTED:github-pat]"
  /xox[bpa]-[a-zA-Z0-9-]{10,}/g,          → "[REDACTED:slack-token]"
  /Bearer\s+[a-zA-Z0-9._-]{20,}/g,        → "Bearer [REDACTED]"
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/g,  → "[REDACTED:private-key]"
  // emails, phone numbers, SSNs only with --strict
];
```

When `--strict` (for sensitive workspaces), routes ALL ingest text
through a local model (Ollama llama3.2 or MLX BitNet) for
context-aware redaction before brain write. Cloud models never see
flagged text.

## 10. References / inspirations

- **agentmemory** (rohitg00/agentmemory, MIT) — 51 MCP tools, 12 hooks, 4-tier consolidation, real-time viewer, knowledge graph BFS, 95.2% R@5. The auto-capture pattern we install in parallel.
- **humanlayer** (humanlayer/humanlayer) — "the best way to get AI coding agents to solve hard problems in complex codebases" — continuous learning loop with human approvals.
- **claude-mem** — proved Arya wants timeline-aware memory. LeScout's session-resume extends that with brain-backed retrieval rather than just timestamps.
- **GBrain** — already on machine, the explicit brain layer.
- **Rowboat** — vault layout reference; entity dirs; Today.md aggregator.

## 11. Definition of done

- M1: `lescout session resume <id>` works from cold for any of last 100 chats. **✓ today**
- M2: Open a new Claude Code chat, ask "resume <id>", get grounded answer in <5s.
- M3: Auto-checkpoint runs on Stop hook for every Claude Code session.
- M4: Pi-5 cron compacts the brain nightly without manual touch.
- M5: A worker pi-subagent stays under 30K tokens by leaning on brain.recall.
- M6: 1000 ingested pages, query latency p95 <300ms.

## 12. Decisions deferred

- Adopt agentmemory now (full install) vs after Phase 3? — **after Phase 3**
- Replace GBrain with LeScout-native brain in Phase 4? — **only if upstream drifts**
- Build the visual graph viewer ourselves vs reuse graphify's `graph.html`? — **reuse graphify's output as the visualizer in Phase 4**
