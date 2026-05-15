# LeScout

> Part of the **LeSearch AI** product family. **Less Search, More Agents.**

LeScout is the **ingestion + context-loader** layer. Sandboxed scouting +
caveman-compress context bundles, fed into the GBrain MCP so every agent on
every machine reads from the same brain.

Sibling tools (planned, same brand):

- **LeBrain** — unified brain layer over GBrain (Phase 4)
- **LeMem** — per-session 100K context discipline + auto-checkpoint (Phase 3)
- **LeLoop** — personal software factory: idea → autonomous prototype → Ralph loop (Phase 6)

See `Plans/BRAND.md` for the full product family + Personal Software Factory thesis.

## Status

```
Phase 0    ✓  GBrain wired as interim brain (Claude Code + pi MCP)
Phase 1    ✓  Sandbox + `lescout repo` end-to-end
Phase 1.5  ✓  Multi-agent session discovery + `lescout session`
Phase 1.6  ✓  Hierarchical `--help` + `lescout docs <github-url>`
Phase 1.7  ✓  `lescout context` — caveman-compress bundles for fresh agents
Phase 2    ⏳  `lescout grok <url>` + SearXNG + dual md/html storage
Phase 3    ⏳  MCP adapter + LeMem auto-checkpoint hooks
Phase 4    ⏳  LeBrain native brain (SQLite + FTS5)
Phase 5    ⏳  Pi-5 deployment + Tailscale remote MCP
Phase 6    ⏳  LeLoop Personal Software Factory
```

## Quickstart

```bash
# 1. Build the sandbox image (one time)
docker build -t lescout/sandbox:latest docker/sandbox/

# 2. Install deps
bun install

# 3. Ingest
lescout repo https://github.com/safishamsi/graphify   # scout a repo into brain
lescout docs https://github.com/colinhacks/zod        # scout as docs (different slug + tag)

# 4. Session discovery (across every agent harness)
lescout session list --limit 10                       # claude/pi/codex/cursor/gemini
lescout session list --agent codex --project mconnect
lescout session resume <chat-id>                      # pick up where you left off

# 5. THE KILLER FLOW — caveman-compress one project's brain into one file:
lescout context lockshell                             # 30K-token bundle written to disk + brain
# In any fresh agent (Claude / Cursor / Codex / Gemini):
#   "Read ~/.lescout/context/lockshell-<date>.md before answering anything."
# → agent loads dense context once, then acts. No re-deriving, no bloat.

# 5. Self-discoverable: agents call --help to learn the surface
lescout help                                          # full reference
lescout repo --help                                   # man-style per-command
lescout session list --help                           # per-subcommand

# 6. Query the brain (via gbrain CLI, MCP, or any agent)
gbrain query "what does graphify do"
```

## What `lescout repo` actually does

```
1. Validate URL against allowlist (github/gitlab/bitbucket/codeberg/sr.ht)
2. Run hardened Docker container:
     --read-only --cap-drop ALL --no-new-privileges
     --memory 1g --cpus 1 --pids-limit 256
     --network bridge --user 1000:1000
3. Inside container:
     git clone --depth 1 --no-tags --no-recurse-submodules
              -c core.hooksPath=/dev/null      ← no foreign hooks
              -c credential.helper=             ← no host creds
     chmod -x every file                       ← defense in depth
     tree -L 3 -J          → tree.json
     copy manifests        → manifest.{package.json,Cargo.toml,...}
     copy READMEs          → doc.{README.md,AGENTS.md,CLAUDE.md,...}
     ripgrep TODO/FIXME    → todos.jsonl
4. Parse artifacts → render markdown brain page
5. `gbrain put repos/<host>/<owner>/<name>` ← only TEXT crosses the boundary
6. Full audit envelope → ~/.lescout/runs/<run-id>/_run.json
```

**Foreign code never executes on the host.** No `npm install`, no `pip install`, no `cargo build`, no postinstall, no setup.py.

## Architecture

```
~/Projects/lescout/
├── bin/lescout                       Convenience wrapper (POSIX shell)
├── docker/sandbox/                   Hardened Alpine image
│   ├── Dockerfile
│   └── scripts/scout-repo.sh
├── packages/scout/                   Bun + TypeScript core
│   ├── src/
│   │   ├── security.ts               URL validation, allowlist
│   │   ├── sandbox.ts                Docker run wrapper
│   │   ├── extract.ts                Parse sandbox artifacts
│   │   ├── brain.ts                  GBrain CLI shell-out + markdown render
│   │   ├── repo.ts                   Orchestrator
│   │   └── bin/lescout.ts            CLI entry
│   └── test/security.test.ts         15 passing
├── Plans/PRD-v1.md                   Full product vision + 10-phase plan
└── research/SYNTHESIS.md             What we steal from rowboat/graphify/gbrain

~/.lescout/runs/<run-id>/             Per-run audit envelope
├── _run.json                         Command, env, exit code, duration
├── tree.json                         Filetree (depth 3, JSON)
├── manifest.*                        package.json, Cargo.toml, etc.
├── doc.*                             READMEs, AGENTS.md, CLAUDE.md, etc.
├── todos.jsonl                       Ripgrep matches
├── sha.txt, meta.txt, lastcommit.txt
└── page.md                           Rendered brain page (also in gbrain)
```

## Inspiration

- **GBrain** (Garry Tan, MIT) — the brain pattern. We use it as interim brain in Phases 0-4; LeScout's own brain lands in Phase 4.
- **Rowboat** (Apache-2.0) — vault structure, `Today.md` aggregator, continuous sync.
- **Graphify** (MIT) — pipeline architecture (`detect → extract → build → analyze → report`), URL allowlist patterns.

See [research/SYNTHESIS.md](research/SYNTHESIS.md) for the full borrow/avoid breakdown.

## License

MIT.
