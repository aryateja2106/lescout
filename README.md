# LeScout

> Part of the **LeSearch AI** product family.
> **Less Search, More Agents.**

LeScout is the *ingestion + context-loader* layer. Sandboxed scouting of
foreign code, plus caveman-compress context bundles, fed into a brain that
every agent on every machine reads from.

```
 ┌───────────────────────────────────────────────────────────────────┐
 │  Repos · Docs · Sessions  ──▶  LeScout (sandbox)  ──▶  Brain      │
 │                                                                   │
 │  Brain  ──▶  LeScout context  ──▶  one dense file  ──▶  Agent     │
 └───────────────────────────────────────────────────────────────────┘
```

**Sibling tools (planned, same brand):**

| Tool | Role | Phase |
|------|------|-------|
| **LeScout** *(this repo)* | Ingestion + sandbox + context bundler | 1.7 ✓ |
| **LeBrain** | Unified brain layer over GBrain → native | 4 |
| **LeMem** | Per-session 100K context discipline + auto-checkpoint | 3 |
| **LeLoop** | Personal Software Factory: idea → prototype → Ralph loop | 6 |

See [`Plans/BRAND.md`](Plans/BRAND.md) for the full Personal Software Factory thesis.

---

## Why

Every developer today spends 30–60% of their time **searching**: docs, Stack
Overflow, X, old chats, their own old code, GitHub. LeSearch flips that:
**search once, agents act forever.** The brain compounds; ingest is
deterministic; retrieval is hybrid; agents run the loops.

LeScout is the first primitive of that stack:

1. **Sandbox** — foreign code (cloned repos) never touches your host. Only
   structured text crosses the container boundary.
2. **Context-loader** — `lescout context <target>` collapses everything the
   brain knows about a project into ONE dense file. A fresh agent loads
   that file and skips the re-derivation cost.

---

## Install

**Prerequisites:** macOS or Linux · [Bun](https://bun.sh) ≥ 1.1 · Docker
(or Colima) · [GBrain](https://github.com/garrytan/gbrain) on `$PATH`.

```bash
# Clone
git clone https://github.com/aryateja2106/lescout.git ~/Projects/lescout
cd ~/Projects/lescout

# Install deps
bun install

# Build the sandbox image (one time; 13 MB Alpine)
docker build -t lescout/sandbox:latest docker/sandbox/

# Add the CLI to your PATH (one of):
ln -s ~/Projects/lescout/bin/lescout ~/.bun/bin/lescout       # if ~/.bun/bin is on PATH
ln -s ~/Projects/lescout/bin/lescout /usr/local/bin/lescout   # system-wide
# …or just: alias lescout="$HOME/Projects/lescout/bin/lescout"

# Verify
lescout --version            # 0.0.5
lescout help                 # the man-page
```

LeScout shells out to `gbrain` from `$PATH`. Override with `GBRAIN_BIN=/abs/path/to/gbrain`.

---

## Quickstart

### The killer flow — give a fresh agent dense project context in one line

```bash
# 1. Compress everything in the brain about a project into one file:
lescout context lockshell                     # 30K-token bundle

# 2. Open a fresh chat in any agent (Claude Code, Cursor, Codex, Gemini, pi)
#    and paste:
> Read ~/.lescout/context/lockshell-2026-05-15.md before answering anything.
> What's the next blocking thing on this project?
```

That's it. The agent now has dense, ranked context: architecture, threat
model, roadmap, contributing notes, related session summaries — without
re-deriving anything.

### Sandbox-scout a repository

```bash
# Read-only Docker, --cap-drop ALL, --no-new-privileges, no postinstall scripts
lescout repo https://github.com/safishamsi/graphify
lescout repo https://github.com/rohitg00/agentmemory --dry-run
```

### Sandbox-scout official docs from a GitHub repo

```bash
lescout docs https://github.com/colinhacks/zod
```

### Discover and resume sessions across every agent harness

```bash
lescout session list --limit 10
lescout session list --agent codex --project mconnect
lescout session resume c1a443ce
```

### Self-discovery for any agent

```bash
lescout help                  # tight man-page
lescout help context          # per-command detail
lescout context --help        # same
```

### Progressive disclosure for skills

Agent skill files (`SKILL.md` with YAML front matter) live in multiple
directories. Loading every body for every agent burns context. LeScout
flips this: read front matter first, fetch bodies only when actually needed.

```bash
lescout skills list                              # ~100 tokens per skill (cheap index)
lescout skills list --scope pi                   # filter by source: pi|shared|claude|extra
lescout skills list --grep build                 # substring filter
lescout skills show build-verify                 # front matter for one
lescout skills load build-verify                 # full body to stdout (pipe-friendly)
lescout skills suggest 'fix a broken build'      # ranked by description-token overlap
lescout skills list --brain                      # write the index to gbrain at
                                                 # skills/index/<date> so other agents can query
```

Default scan roots:
- `~/.pi/agent/skills/`
- `~/.agents/skills/`
- `~/.claude/skills/`
- `$LESCOUT_SKILL_PATH` (colon-separated extra roots)

### Unified artifact registry (`lescout store`)

The meta-tool that covers ALL five artifact types across every coding
agent on the host: **skills + MCPs + hooks + plugins + extensions**. This
is the read MVP — install / remove / sync come in Phase 2 (see
[`Plans/LESTORE.md`](Plans/LESTORE.md)).

```bash
lescout store roots                            # every directory we scan + exists status
lescout store list                             # one normalised table across all 5 types
lescout store list --type mcp                  # only MCP servers (from .claude.json,
                                               # .cursor/mcp.json, .codex/config.toml,
                                               # .bob/settings.json)
lescout store list --type extension            # pi-style extensions
lescout store list --agent claude              # only artifacts scoped to one agent
lescout store search 'fix a broken build'      # ranked across every type
lescout store info <id>                        # manifest for one artifact
```

LeStore is intentionally agent-agnostic in its data model. Today it reads
from existing scattered locations; Phase 2 introduces `~/.lestore/` as a
canonical single-source-of-truth volume with a symlink farm into every
agent's expected path.

---

## What `lescout repo` actually does

```
1. Validate URL against allowlist (github/gitlab/bitbucket/codeberg/sr.ht).
2. Run hardened Docker container:
     --read-only --cap-drop ALL --no-new-privileges
     --memory 1g --cpus 1 --pids-limit 256
     --network bridge --user 1000:1000
3. Inside the container:
     git clone --depth 1 --no-tags --no-recurse-submodules
              -c core.hooksPath=/dev/null     ← no foreign hooks
              -c credential.helper=            ← no host credentials
     chmod -x every file                      ← defense in depth
     tree -L 3 -J          → tree.json
     copy manifests        → manifest.{package.json,Cargo.toml,…}
     copy READMEs          → doc.{README.md,AGENTS.md,CLAUDE.md,…}
     ripgrep TODO/FIXME    → todos.jsonl
4. Parse artifacts → render markdown brain page.
5. `gbrain put repos/<host>/<owner>/<name>`   ← only TEXT crosses the boundary.
6. Full audit envelope → ~/.lescout/runs/<run-id>/_run.json
```

**Foreign code never executes on the host.** No `npm install`, no `pip
install`, no `cargo build`, no `postinstall`, no `setup.py`.

---

## How `lescout context` works (the caveman-compress)

```
target = "lockshell"

1. gbrain query <target>            → top-N ranked chunks (hybrid search)
2. gbrain list --slug-prefix repos/ → name-matched repos
3.                       docs/      → name-matched docs
4.                       sessions/  → name-matched session summaries
5. Dedupe by slug; prefer hits that already carry chunk text.
6. Enrich thin hits with `gbrain get <slug>` (cap 30 fetches, 5 KB each for
   high-scoring hits, 2.5 KB for the rest).
7. Bucket by source type: docs > repos > sessions > notes > concepts > other.
8. Render markdown under a token budget (default 30 K; ~4 chars/token).
9. Write to:
     ~/.lescout/context/<target>-<date>.md
   And to the brain at:
     context/<target>/<date>
```

Re-run `lescout context <target>` any time the brain changes — bundles are
idempotent per-day and rewrite-safe.

---

## Architecture

```
~/Projects/lescout/
├── bin/lescout                       POSIX wrapper → bun run packages/scout
├── docker/sandbox/                   Hardened Alpine 3.20 image
│   ├── Dockerfile
│   └── scripts/scout-repo.sh
├── packages/scout/                   Bun + TypeScript core
│   ├── src/
│   │   ├── bin/lescout.ts            CLI entry + dispatch
│   │   ├── help.ts                   Help catalog
│   │   ├── security.ts               URL validation, allowlist
│   │   ├── sandbox.ts                Docker run wrapper
│   │   ├── extract.ts                Parse sandbox artifacts
│   │   ├── repo.ts                   Repo orchestrator
│   │   ├── session.ts                Multi-agent session discovery
│   │   ├── context.ts                Caveman-compress builder
│   │   └── brain.ts                  GBrain shell-out + markdown render
│   └── test/security.test.ts         15 passing
├── Plans/                            PRD · BRAND · CONTEXT-DISCIPLINE
└── research/                         Synthesis of rowboat / graphify / gbrain

~/.lescout/                           Per-host runtime data (gitignored)
├── runs/<run-id>/                    Per-scout audit envelope
└── context/<target>-<date>.md        Caveman-compress output files
```

---

## Status

```
Phase 0    ✓  GBrain wired as interim brain (Claude Code + pi MCP)
Phase 1    ✓  Sandbox + `lescout repo` end-to-end
Phase 1.5  ✓  Multi-agent session discovery + `lescout session`
Phase 1.6  ✓  Hierarchical `--help` + `lescout docs <github-url>`
Phase 1.7  ✓  `lescout context` — caveman-compress bundles for fresh agents
Phase 1.8  ✓  IBM Bob adapter — multi-agent session discovery covers 6 harnesses
Phase 1.9  ✓  `lescout skills` — progressive disclosure for agent skill files
Phase 1.10 ✓  `lescout store` — unified artifact registry (read MVP) for skills + mcps + hooks + plugins + extensions
Phase 2    ⏳  LeStore install/remove/sync (Phase 2 of LESTORE.md)
Phase 2    ⏳  `lescout grok <url>` + SearXNG + dual md/html storage
Phase 3    ⏳  MCP adapter + LeMem auto-checkpoint hooks
Phase 4    ⏳  LeBrain native brain (SQLite + FTS5)
Phase 5    ⏳  Pi-5 deployment + Tailscale remote MCP
Phase 6    ⏳  LeLoop Personal Software Factory
```

---

## Inspiration

LeScout doesn't fork these — it copies *patterns*, not codebases:

- **[GBrain](https://github.com/garrytan/gbrain)** (Garry Tan, MIT) — the brain pattern. Used as interim brain Phases 0–4; LeBrain lands in Phase 4.
- **[Rowboat](https://github.com/rowboatlabs/rowboat)** (Apache-2.0) — vault structure, `Today.md` aggregator, continuous sync.
- **[Graphify](https://github.com/safishamsi/graphify)** (MIT) — pipeline architecture (`detect → extract → build → analyze → report`), URL allowlist patterns.
- **[AgentMemory](https://github.com/rohitg00/agentmemory)** — 51-tool MCP surface area to study for the LeMem auto-checkpoint hooks.

See [`research/SYNTHESIS.md`](research/SYNTHESIS.md) for the full borrow/avoid breakdown.

---

## Security stance

LeScout was built because mainstream "agent runs your prompts" tools too
often `npm install` or `pip install` their findings straight into your
host. LeScout's hard rule:

> **Foreign code never executes on the host. Period.**
>
> Cloned repos live in a read-only, no-cap, no-net-internal sandbox container.
> Only parsed text (tree, README, manifest manifest, todos) ever crosses
> the boundary into the host filesystem. `npm install` and friends never run.

If you spot a path where a foreign script can reach the host, open an issue
tagged `security`.

---

## License

[MIT](LICENSE) · © 2026 Arya Teja / LeSearch AI
