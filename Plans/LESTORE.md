# LeStore — Unified Artifact Registry for the LeSearch AI Stack

**Tagline:** *One store. Every agent. Five artifact types.*
**Status:** Phase 1 (read MVP shipping in lescout 0.0.10); Phase 2-4 deferred for sign-off
**Sibling:** part of the LeSearch AI family alongside LeScout · LeBrain · LeMem · LeLoop

## Why

A coding agent is only as useful as the **capabilities loaded around it**:
**skills** (SKILL.md), **MCP servers** (live tool extensions), **hooks**
(lifecycle scripts), **plugins** (agent-specific bundles), and **extensions**
(TypeScript modules in pi-style harnesses).

Today these live in 30+ different places, configured 30+ different ways,
and are scoped per-agent. When Arya installs a new coding agent (e.g. IBM
Bob), he has to re-wire every artifact for it manually.

LeStore is the **package manager + dispatcher** for all five types across
every supported agent. It is to agent capabilities what npm is to JavaScript
modules, what brew is to mac binaries, what `npx skills` is to skill files
alone.

## Non-goals

- **Not a new SKILL.md spec** — the existing community spec wins.
- **Not a replacement for `npx skills`** — we WRAP it for skill installs.
- **Not a fork of GBrain or Context Hub** — both are upstream we publish to.
- **Not a new agent runtime** — agents stay as they are; LeStore just curates
  what they see.

## Architecture

```
~/.lestore/                                 ← THE UNIFIED VOLUME
├── artifacts/                              ← canonical: each artifact exists once
│   ├── skill/<slug>/SKILL.md
│   ├── mcp/<slug>/mcp.json
│   ├── hook/<slug>/hook.json
│   ├── plugin/<slug>/plugin.json
│   └── extension/<slug>/manifest.json
├── targets/                                ← per-agent symlink farms (Phase 2)
│   ├── claude-code/skills/<slug>  → ../../artifacts/skill/<slug>
│   ├── codex/skills/<slug>        → ../../artifacts/skill/<slug>
│   ├── bob/skills/<slug>          → ../../artifacts/skill/<slug>
│   ├── …                                   (50+ agents from npx skills mapping)
│   ├── claude-code/mcps/<slug>    → ../../artifacts/mcp/<slug>
│   └── …
├── index.json                              ← cheap searchable index, auto-built
├── installed.json                          ← per-agent install ledger
└── conflicts.json                          ← name collisions across sources
```

### Manifest schema (artifact-agnostic core)

```json
{
  "id": "build-verify",
  "type": "skill" | "mcp" | "hook" | "plugin" | "extension",
  "version": "0.1.0",
  "owner": "lesearch",
  "license": "MIT",
  "description": "Detect project type and run the correct build + lint…",
  "source": {
    "kind": "local" | "github" | "npm" | "git",
    "url": "https://github.com/aryateja2106/lescout"
  },
  "compat": {
    "agents": ["claude-code", "codex", "cursor", "gemini-cli", "bob", "pi"],
    "min_lescout": "0.0.10"
  },
  "triggers": [
    { "type": "phrase", "value": "is the build passing" },
    { "type": "file",   "value": "package.json|Cargo.toml|pyproject.toml" }
  ],
  "exposes": {
    "tools": ["bash", "read"],
    "hooks": [],
    "tokens_approx": 500
  },
  "annotations": [ { "by": "aryateja", "ts": "…", "note": "…" } ]
}
```

Per-type extras (`extras: { … }` block) cover the bits that don't fit:

- **skill** — body bytes, allowed-tools
- **mcp**   — command, args, env, listed-tools
- **hook**  — lifecycle (pre-prompt, post-tool, on-stop), agent
- **plugin**— agent, bundle path, install hook
- **extension** — entrypoint, runtime (bun, node, deno)

### Agent-path map (copied from `npx skills`, extended)

| Agent | Skills | MCPs | Hooks | Extensions |
|-------|--------|------|-------|------------|
| claude-code | `~/.claude/skills/` | `~/.claude.json` | `~/.claude/hooks/` | n/a |
| codex | `~/.codex/skills/` | `~/.codex/config.toml` | n/a | n/a |
| cursor | `~/.cursor/skills/` | `~/.cursor/mcp.json` | n/a | n/a |
| gemini-cli | `~/.gemini/skills/` | n/a | n/a | n/a |
| bob | `~/.bob/skills/` | `bob mcp` | n/a | `bob extensions` |
| pi | `~/.pi/agent/skills/` | n/a | n/a | `~/.pi/agent/extensions/` |
| amp · kimi · replit · cline · dexto · warp · firebender · codex · gemini · github-copilot · opencode | shared `~/.agents/skills/` or per-agent | varies | varies | varies |

(Full table mirrors the 50-agent map shipped by `vercel-labs/skills`.)

## Phased plan

### Phase 1 — READ MVP (ships in lescout 0.0.10, this commit)

- `lescout store list` — every artifact across every discovery root
- `lescout store search <q>` — token-overlap rank across all 5 types
- `lescout store info <id>` — manifest for one
- `lescout store roots` — every place we look on disk
- Backward-compat: `lescout skills` keeps working unchanged

### Phase 2 — INSTALL/REMOVE (after Arya signs off on manifest schema)

- `lescout store install <id> --to <agent>` — wraps `npx skills` for skills;
  for MCPs, edits the right config file; for hooks, drops the script in
  the agent's hook dir
- `lescout store remove <id> --from <agent>`
- `lescout store sync` — reconcile every target with `installed.json`
- Manifest-driven; never edits user code outside `~/.lestore/` and target paths

### Phase 3 — PUBLISH/IMPORT

- `lescout store publish` — push manifests to the brain as
  `store/<type>/<slug>` so any machine can `gbrain query`
- `lescout store import vercel-labs/agent-skills` — wraps `npx skills add`
- `lescout store import chub openai/chat --lang py` — wraps Context Hub
- Cross-machine sync via `lescout-mcp` once that ships

### Phase 4 — TRIGGERS + LONG-RUNNING

- Hot path: agent says "I need X" → `lescout store suggest "X" --type any`
  → returns the artifact(s) → agent loads or LeStore symlinks it in
- Background path: LeLoop runs nightly, watches the install ledger, prunes
  dead links, refreshes annotations, calls `chub feedback` to vote
- Long-running agent compatibility: artifacts surface via a single MCP
  (`lestore`) so any agent can call `lestore.suggest("task")` natively

## Comparison

| Tool | Coverage | Install | Discover | Brain | Cross-agent |
|------|---------|---------|----------|-------|-------------|
| **npx skills** | skills only | ✓ | basic find | ✗ | 50+ ✓ |
| **chub** | docs only | n/a | search/get | ✗ | agnostic ✓ |
| **LeStore (planned)** | skills · mcps · hooks · plugins · extensions | wraps the above | ranked across types | ✓ via gbrain | ✓ (reuses npx skills map) |

## What I'm NOT building today

- The symlink farm in `targets/`
- `installed.json` ledger
- Any write/install/remove operation
- MCP/hook/plugin manifest authoring tools
- The `lestore` MCP

These need your sign-off on:

1. The manifest schema (above — feedback welcome)
2. The directory location (`~/.lestore/` or inside `~/.lescout/store/`?)
3. Whether `lescout store` stays a subcommand or splits to its own CLI (`lestore`)

Until those are decided, building install logic risks rework.

## Out-of-tree references

- **`npx skills`** — `github.com/vercel-labs/skills` — the agent-path map and
  install pattern we copy
- **Context Hub** — `github.com/aisuite/chub` — annotations + feedback loop
  we steal for the docs case
- **Anthropic Agent Skills spec** — the SKILL.md baseline both projects use

## License

MIT, same as the rest of LeSearch AI.
