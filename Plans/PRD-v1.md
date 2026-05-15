# LeScout — Product Requirements Document

**Status:** v1 — DRAFT (2026-05-15)
**Owner:** Arya Teja (`aryateja2106`)
**Tagline:** *Less Scout, More Context*
**License (intended):** MIT

---

## 1. Problem statement

Every coding agent on Arya's machines (pi, Claude Code, Cursor, Codex,
Gemini, Amp) suffers the same three failures:

1. **No persistent memory across sessions/agents.** A reference shared
   in conversation A is forgotten in conversation B, and forgotten by
   the next agent entirely. There is no shared brain.
2. **No safe, deterministic way to learn from foreign URLs / repos.**
   Agents can `curl`, but cannot "see what a human sees." When asked to
   review an open-source repo they parrot the README and miss the tree,
   manifests, key entrypoints, and AGENTS.md/CLAUDE.md conventions.
   And running unknown code on the host is unacceptable.
3. **Vendor lock-in for search and ingestion.** Exa, Firecrawl, Tavily,
   etc. cost money, leak queries, and are unreliable for hackathon
   environments where Arya needs to ship in <24 hrs.

These compound at hackathons, where Arya solo-builds against a clock,
and on multi-machine setups (Mac dev, Ubuntu VPS, Raspberry Pi 5
always-on server) where context should follow the work, not the box.

## 2. Vision

LeScout is a **two-half personal knowledge stack** that lives across
Arya's machines and is reachable by every agent harness he uses:

- **Scout half** — search, fetch, and *safely* ingest URLs / docs /
  repos / videos / PDFs into structured text + metadata. Foreign code
  is processed inside an ephemeral Docker container and never executes
  on the host.
- **Brain half** — a hybrid-search (BM25 + graph + vector-later)
  knowledge graph of typed entities (Person, Repo, Article, Decision,
  Project, Tool, Concept), self-wiring on every write, queryable by
  any agent.

The **Raspberry Pi 5** is the always-on brain server. The Mac, the
Ubuntu VPS, and any future client machine connect via remote MCP
(over Tailscale) so every agent on every machine reads/writes the
same brain.

## 3. Non-goals (what LeScout is NOT)

- Not a calendar/email assistant (rowboat does this; out of scope).
- Not a video/article publishing tool (gitrepo-kb is that).
- Not a multi-tenant SaaS. Single-user, multi-machine, personal.
- Not a code-execution sandbox for agent-generated code (different
  problem, different tool).

## 4. Hard constraints

| Constraint | Rationale |
|------------|-----------|
| **Bun + TypeScript** runtime | Matches Arya's other projects, fast cold start, single binary distribution. |
| **Docker + Colima** for sandbox | Already installed, broadly understood, no new tooling. |
| **Git + Docker only** for primitives | Don't introduce Podman/gVisor/etc. now; revisit later. |
| **Foreign code never runs on host** | Sandbox container is read-only mount, no host network egress, no shell exec of cloned scripts. Only structured text crosses the boundary. |
| **Three DB scopes** | Global (`~/.lescout/global.db`), project (`./.lescout/project.db`), local (`/tmp/lescout/<id>.db`). Mirrors `.claude` / `.codex` patterns. |
| **MIT license** | Public, permissive, encourages reuse. |
| **Apple + Linux + ARM** | Must run on macOS arm64, Ubuntu x86_64, and Raspberry Pi 5 (arm64). |
| **MLX support (later)** | When local embeddings land, MLX is the Apple path. GGUF/llama.cpp on Linux/Pi. |

## 5. Architecture (v1)

```
┌────────────────────────────────────────────────────────────────┐
│ Mac dev machine    Ubuntu VPS (32GB)    Future Linux clients  │
│ ┌─────────────┐    ┌─────────────┐      ┌─────────────┐       │
│ │ pi          │    │ Codex CLI   │      │ Claude CLI  │       │
│ │ Claude Code │    │ Claude CLI  │      │ pi          │       │
│ │ Cursor      │    │ ...         │      │ ...         │       │
│ └──────┬──────┘    └──────┬──────┘      └──────┬──────┘       │
│        │                   │                    │              │
│        └───────────────────┼────────────────────┘              │
│                            │                                   │
│                  Remote MCP (stdio over SSH)                   │
│                  + Custom HTTP connector                       │
│                  over Tailscale tailnet                        │
│                            │                                   │
└────────────────────────────┼───────────────────────────────────┘
                             ▼
              ┌──────────────────────────────────┐
              │  Raspberry Pi 5 (always-on)      │
              │  ────────────────────────────    │
              │  • lescout-server (Bun/Hono)     │
              │  • SearXNG (Docker)              │
              │  • Brain DB (SQLite + FTS5;      │
              │    PGLite if RAM permits)        │
              │  • Sandbox container farm        │
              │    (rootless Docker)             │
              │  • Action audit log              │
              │  • Cron syncs (git, RSS, etc.)   │
              └──────────────────────────────────┘
```

### 5.1 Scout commands (CLI surface)

```
lescout search <query>             SearXNG → top N JSON
lescout grok <url>                 Fetch + extract → brain
lescout repo <git-url|path>        Sandbox clone + tree + manifest → brain
lescout file <path>                Local file ingest → brain
lescout pdf <url|path>             pdftotext in sandbox → brain
lescout yt <url>                   yt-dlp + whisper.cpp in sandbox → brain
lescout today                      Aggregator (rowboat-pattern)
lescout log [--tail N]             Audit trail of actions
lescout sync [--to <host>]         Push local brain to server
```

### 5.2 Brain commands (CLI surface)

```
lescout ask <question>             Hybrid search (BM25 + graph)
lescout get <slug>                 Read entity page
lescout put <slug> < file          Write/update entity page
lescout list [--type T]            List entities by type
lescout related <slug>             Backlinks + typed edges
```

### 5.3 Adapters

| Adapter | Status | Used by |
|---------|--------|---------|
| CLI (`lescout`) | Build Phase 1 | pi, codex, gemini, amp, raw shell |
| MCP stdio | Build Phase 2 | Claude Code, Cursor |
| MCP over SSH | Build Phase 3 | Remote agents reaching Pi-5 brain |
| HTTP `/api/v1/*` | Build Phase 3 | Custom connectors, browser extension later |
| Pi extension | Build Phase 2 | pi (`/skill:lescout`) |

## 6. Sandbox specification

The single most-important property. If this is wrong, LeScout is unsafe.

```
Host                         Sandbox container
────                         ─────────────────
                             Image: lescout/sandbox:latest
                             Base:  alpine:3.20
                             Tools: git, ripgrep, jq, curl,
                                    pdftotext, yt-dlp,
                                    tree, file, sqlite3
                             User:  nonroot (uid 1000)

scout repo <url>      ──▶    docker run --rm \
                               --network=lescout-egress \
                               --read-only \
                               --tmpfs /work:exec,size=512m \
                               --cap-drop ALL \
                               --security-opt no-new-privileges \
                               --memory 1g --cpus 1 \
                               -v $RUN_DIR:/out:ro \
                               lescout/sandbox \
                               /scripts/scout-repo.sh <url>

                             # inside container:
                             git clone --depth 1 --no-tags <url> /work/repo
                             tree -L 3 -J /work/repo > /out/tree.json
                             jq < /work/repo/package.json > /out/manifest.json
                             cat /work/repo/README.md > /out/readme.md
                             cat /work/repo/AGENTS.md /work/repo/CLAUDE.md \
                               2>/dev/null > /out/agents.md
                             rg --json "TODO|FIXME" /work/repo > /out/todos.jsonl

                             # NO npm install / pip install / cargo build
                             # NO postinstall / setup.py / build.rs
                             # exec bit on cloned files NEVER honored

scout repo <url>      ◀──    structured JSON only
                             { tree, manifest, readme, agents,
                               todos, sha, run_id, action_log }
                             → host reads + sends to brain
```

Network policy: `lescout-egress` is a custom Docker bridge with an
allowlist (github.com, gitlab.com, raw.githubusercontent.com,
pypi.org, npmjs.com, registry.npmjs.org, ...). Anything else is
denied at the iptables level.

Audit: every container run writes `~/.lescout/runs/<run_id>/` with
the full command, env, exit code, stdout/stderr, and JSONL action
log. `lescout log <run_id>` replays it for human or agent review.

## 7. Phases

| # | Goal | Outcome | Est. |
|---|------|---------|------|
| 0 | Wire **GBrain MCP** into Claude Code + pi (interim brain) | Tommy and Claude both stop forgetting links. Dogfood test: ingest rowboat + graphify READMEs, then I can answer "what does graphify do?" without re-fetching. | 2 hrs |
| 1 | Install rowboat locally + observe its on-disk vault | Reference architecture for `Today.md`, entity folders, agent prompts. | 1 hr (mostly Arya clicking) |
| 2 | LeScout repo skeleton (mono-repo, packages, biome, tsc, vitest, dockerfile) | Clean foundation, builds + lints green | 2 hrs |
| 3 | **Sandbox container** + `lescout repo <url>` end-to-end | First real value: agents can onboard a repo safely | 1 day |
| 4 | **SearXNG** in compose + `lescout search` + `lescout grok` | Kills Exa/Firecrawl. Web research auto-flows to brain. | 1 day |
| 5 | Brain layer — SQLite + FTS5, typed entities, self-wiring graph | LeScout becomes self-sufficient (no longer depends on GBrain) | 2 days |
| 6 | MCP stdio adapter | Claude Code and Cursor get LeScout natively | 0.5 day |
| 7 | **Pi-5 deploy** — Docker compose for ARM64, install on Pi | Always-on brain server live | 1 day |
| 8 | **Remote MCP over Tailscale SSH** | Mac + VPS + future clients all read/write Pi-5 brain | 0.5 day |
| 9 | First-class hackathon mode — `lescout init <event>` spins per-event scope | Hackathon-ready in seconds | 0.5 day |
| 10 | MLX embeddings (Mac) / GGUF (Linux/Pi) for semantic search | Hybrid retrieval complete | Later |

## 8. Open questions (need answers before building)

- Q1: Brain DB engine — **SQLite + FTS5** (Pi-friendly, already on every box) vs **PGLite** (richer, what GBrain uses, ~150MB RAM idle on Pi). Recommend SQLite for v1.
- Q2: When LeScout brain is shippable (Phase 5), do we **migrate from GBrain** or run **both** with a one-way sync? Recommend migrate.
- Q3: How do other Arya repos (LeSearch, CloudAGI, NL2Shell, aryateja.com) ingest into the brain? `lescout sync --watch` cron on Pi-5? Or git post-commit hook?
- Q4: Multi-user later? Single-user is the v1 contract. Multi-user changes auth model significantly.

## 9. Success metrics

- **M1:** Asked the same reference URL twice in two sessions. Tommy answers from brain on the second ask, never re-fetches. ✅ when true.
- **M2:** From cold, "lescout this hackathon repo" returns tree + manifests + README in <10s. ✅ when true.
- **M3:** Same query against the brain returns identical top-3 from Mac, VPS, and Pi-5. ✅ when true.
- **M4:** A malicious npm postinstall script in a scouted repo does NOT execute on the host. (Verified by canary repo with `postinstall: rm -rf ~/`.) ✅ when true (this is the safety contract).
- **M5:** SearXNG-backed `lescout search` returns relevant results for 9/10 hackathon-style queries within 3s. ✅ when true.

## 10. Inspiration / prior art

- **GBrain** (`~/Projects/gbrain`, Garry Tan, MIT) — primary inspiration for the brain half. We will fork patterns, not the codebase. Use as interim brain for Phases 0–4.
- **rowboat** (`rowboatlabs/rowboat`, Apache-2.0) — vault structure, `Today.md` aggregator, entity folder layout, OAuth integrations pattern.
- **graphify** (`safishamsi/graphify`) — typed-edge schema and self-wiring extraction pattern.
- **claude-mem** (`~/.claude-mem`) — proves the "shared memory across agents" UX is what Arya already loves.
- **btca** — proves the "ask the repo, not the internet" framing resonates with developers.

---

*Living doc. Update as decisions land. Next revision after rowboat install + researcher report (`research/rowboat-vs-graphify.md`).*
