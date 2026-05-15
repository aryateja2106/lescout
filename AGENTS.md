# AGENTS.md — guidance for AI agents working in or with this repo

Welcome. If you're an LLM agent (Claude Code, Cursor, Codex, Gemini, pi, Amp),
this file tells you how to use LeScout effectively and how to contribute to
its codebase safely.

## TL;DR — what LeScout gives you

```
lescout context <target>     ← run this BEFORE touching a new project.
                                It writes a dense brain bundle to
                                ~/.lescout/context/<target>-<date>.md
                                Read that file. It is what you would
                                otherwise spend 50 turns re-deriving.

lescout help                 ← every command, every flag, every example.
                                Designed so you can scan it in one read.
```

## When you start a new session on an existing project

1. Run `lescout context <project>` (e.g. `lescout context lockshell`).
2. Read `~/.lescout/context/<project>-<date>.md` *first*.
3. Then read the user's actual request.
4. The bundle contains ranked excerpts from docs, repos, sessions, and notes
   — load it into your context window once, then act.

If `lescout` is not on PATH, the user can also fetch the bundle from the
brain via `gbrain get context/<target>/<date>` or `mcp__gbrain__query`.

## When the user asks you to "scout" a repo or doc URL

Use `lescout repo <url>` or `lescout docs <url>`. **Do not** `git clone`
yourself — that would put foreign code on the host. LeScout's sandbox is
the entire point.

```bash
lescout repo https://github.com/<owner>/<name>      # ingest + brain write
lescout repo https://github.com/<owner>/<name> --dry-run   # inspect only
```

## When the user asks "what was I working on yesterday?"

```bash
lescout session list --limit 10
lescout session list --agent claude --project <substring>
lescout session show <chat-id-prefix>
lescout session resume <chat-id-prefix>
```

`resume` writes a brain summary so any other agent can pick up too.

## Contributing to LeScout itself

If you are an agent asked to modify LeScout:

- **Stack**: Bun + TypeScript. No Node-specific deps.
- **Tests**: `bun test` from repo root. All 15 must pass.
- **Build verify**: `bunx tsc -b` must succeed clean.
- **Security tests are non-negotiable** — `packages/scout/test/security.test.ts`.
- **No new package managers** — Bun only. No npm, pnpm, yarn introduction.
- **No new shell-out targets** — `gbrain`, `docker`, `git` are the only
  external binaries the runtime touches. Anything else needs a justified
  PR.
- **Sandbox flags are sacred** — `--read-only`, `--cap-drop ALL`,
  `--no-new-privileges` may not be relaxed in the default sandbox path.
- **Commit format**: conventional (`feat(scope): description`). Trailers:
  `Co-thought-with: <agent> (<harness>)` if pair-worked.

## What NOT to do

- Don't `npm install` or `pip install` anything you found inside a scouted
  repo. The sandbox is the only place to execute foreign code, and even
  there it isn't executed.
- Don't bake your API key into example commands. Use `${VAR}` form.
- Don't fork GBrain. LeBrain (Phase 4) is the planned successor.
- Don't add a new "framework" — LeScout is intentionally a thin
  composer. Keep it that way.

## See also

- `README.md` — install, killer flow, architecture
- `Plans/BRAND.md` — LeSearch AI product family, Personal Software Factory thesis
- `Plans/PRD-v1.md` — 10-phase plan
- `Plans/CONTEXT-DISCIPLINE.md` — 100K-token budget rules, redaction patterns
- `research/SYNTHESIS.md` — what we steal from rowboat / graphify / agentmemory
