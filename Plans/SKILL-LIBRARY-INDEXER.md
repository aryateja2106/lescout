# Skill Library Indexer + Search-Not-Preload Retrieval

> Plan drafted 2026-05-21. Extends `lescout skills` from gbrain-indexed to filesystem-indexed.
> Decision pending: canonical tree (Phase 2), 3a vs 3b (Phase 3).

## Problem

Skill descriptions are loaded into every agent turn as routing metadata. Codex caps each at 1024 chars; Claude Code has no hard cap but pays full token cost. Arya's authored PAI skills overflow (Telos 1529, ISA 2229, huggingface-datasets 4625) so Codex truncates while Claude Code pays full freight — and the truncation lives in `~/.agents/skills` as a separately edited tree, so the two stores drift. Meanwhile `~/Personal-skills/` (1606 files, 4+ batch directories, skill-lab, skill-scanner, inventory) is unindexed and unreachable from any agent. Net effect: every launch burns ~2% of context on metadata for skills the agent mostly doesn't use, and the personal library is invisible.

## Goal

One indexed, searchable skill library. Agents call `skills suggest <task>` on demand (progressive disclosure, ~100 tokens/hit) instead of carrying the full description block at boot. Single source of truth. Works for both Claude Code and Codex. Shippable in two evenings.

## Architecture

**Index location.** `~/.lescout/skills.db` — SQLite via `bun:sqlite` (zero install, fast FTS5, already PAI default).

**Schema (one table + FTS shadow):**
```
skills(id, name, scope, source_path, body_hash, byte_size,
       description, triggers, anti_triggers, frontmatter_json,
       indexed_at, last_seen_at)
skills_fts(name, description, triggers) -- FTS5 virtual table
```
`scope ∈ {pai-claude, pai-codex, plugin-cc, plugin-codex, personal, experimental}`. `triggers` parsed from "USE WHEN …" tail. `anti_triggers` from "NOT FOR …".

**Source trees scanned:**
- `~/.claude/skills/*/SKILL.md` → `pai-claude` (22 found)
- `~/.agents/skills/*/SKILL.md` → `pai-codex` (41)
- `~/.claude/plugins/cache/**/SKILL.md` → `plugin-cc` (166)
- `/opt/homebrew/lib/node_modules/oh-my-codex/skills/*/SKILL.md` → `plugin-codex` (44)
- `~/Personal-skills/**/SKILL.md` (excluding `vendor/`, `backups/`, `mattpocock-skill-zips/`) → `personal`

**Rebuild model.** No daemon. Three triggers:
1. `lescout skills index` — explicit, idempotent, walks all roots, upserts by `source_path`, deletes rows whose `last_seen_at < run_start`.
2. SessionStart hook → fires `lescout skills index --quick` (mtime-only check, <300ms).
3. PostToolUse hook on Write/Edit where path matches `**/SKILL.md` → re-index that one file.

**Retrieval API (extends `packages/scout/src/skills.ts`):**
- `lescout skills suggest "<task>" [--scope=...] [--top=5]` — FTS5 ranked by BM25 over name+description+triggers, returns name/scope/path/one-line summary.
- `lescout skills load <name>` — prints full SKILL.md body (the only call that returns the long text).
- `lescout skills list [--scope=personal]` — terse: name + first 80 chars of description.
- `lescout skills show <name>` — frontmatter + path + sibling files in skill dir.
- `lescout skills diff <name>` — when the same name exists in `pai-claude` and `pai-codex`, show drift.
- `lescout skills publish <name> [--targets=claude,codex]` — copy canonical source to target trees, applying Codex's 1024-char description truncation rule with a deterministic truncator (keep first sentence + "USE WHEN" tail).

## Phased Plan

**Phase 1 — Indexer (evening 1, ~2h).**
Extend `packages/scout/src/skills.ts`. Add `IndexBuilder` walking the five roots. Parse SKILL.md frontmatter with `gray-matter`. Extract `triggers` regex `/USE WHEN ([^.]+)/i` and `anti_triggers` from `/NOT FOR ([^.]+)/i`. Skip the "MANDATORY: Voice Notification" body prelude when computing body hash so cosmetic prelude edits don't churn the index. Write SQLite + FTS5. Ship CLI: `lescout skills index`, `list`, `suggest`, `load`, `show`.

**Phase 2 — Drift kill + canonicalisation (evening 2, ~2h).**
Pick canonical root: `~/.claude/skills/` for PAI-authored skills (the long-form originals). Add `publish` command that writes truncated copies to `~/.agents/skills/`. Run once. Add a SessionStart hook for both CC and Codex that calls `lescout skills index --quick`. Add a PostToolUse hook to re-publish on SKILL.md edits in the canonical tree. Personal-skills stays where it is — indexed only, never autoloaded.

**Phase 3 — Move off autoload (deferred, decision required).**
Goal: stop CC/Codex from system-prompting the full skill metadata. Two viable paths — pick after measuring:
- **3a (preferred):** Move canonical source to `~/Personal-skills/global/`. Leave shimmed empty `SKILL.md` files in `~/.claude/skills/` and `~/.agents/skills/` containing only `name` + 80-char pointer description saying "search via `lescout skills`". Agent context drops to ~name list.
- **3b:** Empty those trees entirely. Add a one-line CLAUDE.md/AGENTS.md directive: "Before answering, run `lescout skills suggest <task>` to find relevant skills." Maximum savings, requires the agent to actually obey the directive — verify with Evals before committing.

Neither CC nor Codex exposes a flag to disable skill autoload as of writing — confirm in Phase 3 prep.

## Open Questions

1. Does the SessionStart hook fire early enough in Codex to update the index before the model sees the skill block? If not, the quick-index has to run via cron or a PostSessionStart equivalent.
2. For plugin-provided skills (166 in `~/.claude/plugins/cache`), are we allowed to shim them out, or do plugin loaders re-materialise them? Test by emptying one and reloading.
3. Should `personal` skills ever be promoted to autoload, or is `lescout skills load` always the entry point?

## Decision Points for Arya

- **Canonical tree:** `~/.claude/skills/` (status quo, less migration) vs `~/Personal-skills/global/` (cleaner, one move). Recommend the first for Phase 1-2, second for Phase 3.
- **Truncation rule for Codex publish:** keep first sentence + USE-WHEN tail (deterministic) vs keep first 1024 chars verbatim (lossy on long skills). Recommend the first.
- **Tool surface:** keep inside `lescout skills` (recommended — already 80% built) vs spin off `leskills`. No reason to fork.
- **Phase 3 path:** 3a (shim) vs 3b (empty + directive). Decide after measuring Phase 2 savings.

## First commit looks like

A single PR to `~/Projects/lescout` that:
1. Adds `packages/scout/src/skill-index.ts` with `walkRoots()`, `parseSkill()`, `upsert()`.
2. Adds SQLite + FTS5 schema migration in `packages/scout/src/db.ts`.
3. Extends `packages/scout/src/skills.ts` so `lescout skills index` walks the five real filesystem roots (not just gbrain) and `suggest`/`load`/`list` query the new table.
4. One Bun test in `packages/scout/test/skills.test.ts` that indexes a fixture dir with three SKILL.md files and asserts `suggest "telos goals"` ranks Telos first.

No hooks, no publish command, no migration — that's Phase 2. Ship the index + retrieval first, prove the search quality, then disable autoload.

## Verification (Phase 2 exit criterion)

Before/after token measurement: capture the system prompt token count from a fresh CC session pre-change and post-change (CC exposes this in `/cost` or via the transcript file under `~/.claude/projects/*/transcript-*.jsonl` — read the `system` field's `cache_creation_input_tokens`). Target: skill-metadata fraction drops from current ~2% to <0.3%. Same measurement for Codex via its session log.

## Critical files to read first

- `~/Projects/lescout/packages/scout/src/skills.ts`
- `~/Projects/lescout/packages/scout/test/skills.test.ts`
- `~/.agents/skills/find-skills/SKILL.md`
- `~/.claude/skills/Telos/SKILL.md`
- `~/Projects/lescout/Plans/CONTEXT-DISCIPLINE.md`
