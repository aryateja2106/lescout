# LeScout Herdr-Style Mission Control Plan

## Context

LeScout already owns the durable session-memory layer for Arya's agent workflow:
it discovers on-disk sessions across Claude Code, Pi, Codex, Cursor, Gemini, and
Bob; it can render full parser-supported sessions into brain-ready summaries;
and it exposes context-loading commands that fresh agents can consume.

Herdr proves a complementary runtime shape: a lightweight terminal-native
multiplexer with persistent workspaces, tabs, panes, direct attach, automatic
agent state detection, socket-driven orchestration, and first-class agent
states (`blocked`, `working`, `done`, `idle`, `unknown`).

LeSearch AI will need both halves:

- Durable agent memory and resume context from LeScout.
- Live terminal/session control that the iPhone, iPad, Watch, and bridge daemon
  can inspect or attach to.

This plan turns LeScout into the session intelligence/control index that can
feed a Herdr-like runtime now and a native LeSearch bridge later.

## Non-Negotiable Boundaries

- Do not copy Herdr source into LeScout. Herdr is AGPL-3.0; LeScout is currently
  MIT. Use Herdr as an optional runtime backend or as interface inspiration,
  not as vendored code.
- Do not make LeScout a heavy GUI or Electron app. Keep LeScout as a thin CLI
  and data/API composer.
- Do not kill agent processes by default. Process termination must be explicit,
  dry-runnable, and tied to a visible session/process identity.
- Do not add unsafe shell-out targets casually. LeScout's existing repo contract
  only allows `gbrain`, `docker`, and `git` without a justified PR. Any runtime
  control shell-outs need a dedicated architecture note and tests.
- Cursor and Gemini must not be presented as resumable until parsers or native
  resume-command adapters are implemented.

## Product Shape

LeScout becomes the "session index and context bridge" for the LeSearch agent
stack.

It should answer four questions quickly:

1. What agent sessions exist across all harnesses?
2. Which sessions are resumable, metadata-only, live, stale, blocked, or done?
3. What command or terminal backend can reopen/attach to the session?
4. What compact context should be handed to a fresh agent or mobile terminal?

Herdr-like runtime control should be additive:

- If Herdr is installed, LeScout can read Herdr state and map workspaces/tabs/
  panes into LeScout's session model.
- If Herdr is not installed, LeScout still works from disk-backed session stores
  and hook/event logs.
- The LeSearch Mac bridge can consume the same LeScout session model without
  caring whether the backend is Herdr, tmux, a plain shell, or a future native
  Swift/Rust terminal server.

## Proposed Session Model

Add a normalized runtime/session record alongside today's `SessionMeta`:

```ts
export type SessionRuntimeState =
  | "blocked"
  | "working"
  | "done"
  | "idle"
  | "stale"
  | "offline"
  | "unknown";

export type SessionResumeSupport =
  | "context"
  | "native-resume"
  | "direct-attach"
  | "meta-only";

export interface RuntimeSession {
  id: string;
  agent: "claude" | "pi" | "codex" | "cursor" | "gemini" | "bob" | "opencode";
  host: string;
  cwd: string;
  project: string;
  title: string | null;
  state: SessionRuntimeState;
  support: SessionResumeSupport[];
  transcriptPath: string | null;
  attachTarget: string | null;
  resumeCommand: string | null;
  contextSlug: string | null;
  startedAt: string | null;
  lastSeenAt: string | null;
}
```

Interpretation:

- `context`: LeScout can summarize the session into brain/context.
- `native-resume`: the underlying agent has a resume command LeScout can print.
- `direct-attach`: a runtime backend can attach to the live terminal.
- `meta-only`: LeScout can list the session but cannot summarize/resume safely.

## Command Surface

Phase the CLI so it stays useful at each step:

```bash
lescout session list --table
lescout session list --json
lescout session status
lescout session resume-command <id>
lescout session resume <id>
lescout runtime list
lescout runtime attach <target>
lescout runtime read <target> --lines 80
```

Command responsibilities:

- `session list --json`: stable machine-readable inventory for LeSearch AI.
- `session status`: human dashboard with agent, state, support, project, and
  last activity.
- `session resume-command <id>`: print the safest native command, for example
  `codex resume <id>`, `claude --resume <id>`, `pi --resume <id>`, or
  `gemini --resume <id>` when known.
- `session resume <id>`: keep today's brain-summary behavior for
  parser-supported sessions.
- `runtime list`: show live workspaces/panes when a runtime backend is present.
- `runtime attach/read`: delegate to Herdr or future native bridge only when the
  backend can prove an attach target.

## Backend Strategy

Use provider adapters behind one interface:

```ts
export interface RuntimeBackend {
  name: "disk" | "hooks" | "herdr" | "tmux" | "native-bridge";
  available(): Promise<boolean>;
  list(): Promise<RuntimeSession[]>;
  read?(target: string, opts: { lines: number; source: "recent" | "visible" }): Promise<string>;
  attachCommand?(target: string): Promise<string>;
}
```

Recommended adapter order:

1. `disk`: current LeScout session discovery; always available.
2. `hooks`: `~/.agentops/events.jsonl` or `~/.lescout/events.jsonl`; adds live
   state without terminal control.
3. `herdr`: optional adapter when `herdr` is installed and a socket is present.
4. `tmux`: optional adapter for old sessions, only after command policy is
   approved.
5. `native-bridge`: LeSearch Mac bridge daemon, later.

## Herdr Compatibility Map

LeScout should adopt the useful contracts, not the implementation:

| Herdr concept | LeScout / LeSearch equivalent |
| --- | --- |
| workspace | project or host-scoped working directory |
| tab | subtask or agent lane |
| pane | live terminal/session endpoint |
| agent status | `RuntimeSession.state` |
| socket API | provider adapter boundary |
| `pane read` | `runtime read` |
| `agent attach` | `runtime attach` |
| integrations | hooks/events adapter |

## Mobile Terminal Implications

The mobile app should not scrape terminal output or agent logs directly.

It should ask the Mac bridge for:

- `GET /sessions`: normalized `RuntimeSession[]`.
- `GET /sessions/:id/context`: compact resume context.
- `POST /sessions/:id/attach`: open a terminal stream if available.
- `POST /sessions/:id/resume`: spawn a new native resume command if direct
  attach is unavailable.
- `GET /sessions/:id/transcript`: recent rendered text when permitted.

This keeps the iPhone/iPad/watch UI independent from Claude/Codex/Pi/Gemini
storage details.

## First Implementation Slice

Start with a no-daemon, disk-backed slice:

1. Add `--json` to `lescout session list`.
2. Add explicit support labels to card/table output:
   - `full` sessions: `context`
   - agents with known native resume syntax: `native-resume`
   - Cursor/Gemini until parsed: `meta-only`
3. Add `lescout session resume-command <id>`.
4. Add unit tests for resume command generation.
5. Verify with:
   - `bun test`
   - `bunx tsc -b`
   - `lescout session list --limit 10 --table`
   - `lescout session list --limit 3 --json`
   - `lescout session resume-command <known-id>`

This gives the future mobile terminal a stable inventory contract before any
runtime backend exists.

## Second Implementation Slice

Add a hook/event-backed runtime overlay:

1. Define `~/.lescout/events.jsonl` with a stable event envelope:

```json
{"ts":"2026-05-20T00:00:00Z","agent":"codex","event":"state","session_id":"...","cwd":"/repo","state":"working","message":"running tests"}
```

2. Add `lescout runtime list --json`.
3. Merge disk sessions with recent hook events by `(agent, session_id, cwd)`.
4. Mark sessions as:
   - `working` when a recent state event says working.
   - `blocked` when a recent approval/input event says blocked.
   - `stale` when no event has appeared after a configurable timeout.
   - `offline` when only disk metadata exists.

## Third Implementation Slice

Add optional Herdr adapter:

1. Detect `herdr` on PATH and a valid Herdr socket/session.
2. Read `herdr workspace list`, `herdr tab list`, `herdr pane list`, and
   `herdr agent list` through CLI wrappers.
3. Map Herdr pane IDs into `RuntimeSession.attachTarget`.
4. Implement:

```bash
lescout runtime list --backend herdr --json
lescout runtime read <pane-id> --lines 80
lescout runtime attach <pane-id>
```

5. Keep Herdr optional. LeScout should not require it to list historical
   sessions.

## Risks

- Licensing: copying Herdr code into LeScout would pull AGPL obligations into
  the project. Avoid vendoring.
- Session IDs: live pane IDs are not durable. Store durable transcript/session
  IDs separately from runtime attach targets.
- False confidence: metadata-only sessions must be visually obvious so agents
  do not assume they can resume/summarize them.
- Safety: process kill and destructive controls belong behind the Rust policy
  classifier in LeSearch AI, not inside the first LeScout CLI slice.
- RAM pressure: the dashboard should show active agents and memory/process
  facts eventually, but LeScout should not keep its own long-running heavy
  process for v0.1.

## Success Criteria

- A fresh agent can run one command and see all historical sessions, whether
  each is resumable, and the exact native resume command where known.
- LeSearch AI can consume `lescout session list --json` without parsing human
  terminal UI.
- Cursor/Gemini appear honestly as metadata-only until parser support lands.
- Herdr can be added as an optional live backend without changing the mobile
  app contract.
- No existing LeScout sandbox/security guarantees are weakened.
