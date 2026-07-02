// session.ts — multi-agent session discovery + parse + summarize.
//
// Storage layouts:
//   claude  ~/.claude/projects/<sanitized-cwd>/<uuid>.jsonl
//   pi      ~/.pi/agent/sessions/<sanitized-cwd>/<ts>_<uuid>/<wid>/run-<N>/session.jsonl
//   codex   ~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-<ts>-<uuid>.jsonl
//                + ~/.codex/archived_sessions/rollout-<ts>-<uuid>.jsonl
//   cursor  ~/.cursor/chats/<hash>/                    (parse deferred)
//   gemini  ~/.gemini/history/<workspace>/             (parse deferred)
//   bob     ~/.bob/tmp/<workspace-hash>/chats/*        (parse deferred — added 0.0.8)
//
// To add a NEW coding agent, append to the Agent union and add a discovery
// branch in listSessions(). If JSONL-compatible, set parserSupport="full";
// otherwise "meta-only" until a parser ships.

import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, basename, dirname } from "node:path";

const HOME = homedir();
const CLAUDE_ROOT = join(HOME, ".claude", "projects");
const PI_ROOT = join(HOME, ".pi", "agent", "sessions");
const CODEX_ROOT = join(HOME, ".codex", "sessions");
const CODEX_ARCHIVE = join(HOME, ".codex", "archived_sessions");
const CURSOR_ROOT = join(HOME, ".cursor", "chats");
const GEMINI_ROOT = join(HOME, ".gemini", "history");
const BOB_ROOT = join(HOME, ".bob", "tmp");

export type Agent = "claude" | "pi" | "codex" | "cursor" | "gemini" | "bob";

export interface SessionMeta {
  agent: Agent;
  chatId: string; // full uuid (or path hash for cursor/gemini)
  shortId: string; // legacy short handle, usually first 8 chars
  /** Collision-resistant handle for UI/list output. UUIDv7 prefixes collide often. */
  displayId?: string;
  jsonlPath: string;
  projectDir: string; // sanitized cwd or workspace name
  cwd: string; // unsanitized cwd (best-effort)
  title: string | null;
  startedAt: string | null;
  endedAt: string | null;
  lineCount: number;
  sizeBytes: number;
  /** Only Claude / pi / Codex have full parser support today. */
  parserSupport: "full" | "meta-only";
  usage: SessionUsage | null;
}

export interface SessionUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningOutputTokens: number | null;
  totalTokens: number | null;
  costUsd: number | null;
  model: string | null;
  source: "provider-log" | "codeburn" | "estimated" | "unknown";
}

export type SessionResumeSupport = "context" | "native-resume" | "meta-only";

export interface SessionListItem extends SessionMeta {
  support: SessionResumeSupport[];
  resumeCommand: string | null;
  contextSlug: string | null;
}

export interface SessionDetail extends SessionMeta {
  firstUserMessage: string;
  lastAssistantText: string;
  allUserMessages: string[];
  assistantTextChunks: string[];
  toolCounts: Record<string, number>;
  filesTouched: Array<{ path: string; tool: string; count: number }>;
  totalAssistantChars: number;
  durationMs: number;
}

export function sessionResumeCommand(s: Pick<SessionMeta, "agent" | "chatId" | "parserSupport">): string | null {
  if (s.parserSupport !== "full") return null;
  const id = shellArg(s.chatId);
  switch (s.agent) {
    case "claude":
      return `claude --resume ${id}`;
    case "pi":
      return `pi --resume ${id}`;
    case "codex":
      return `codex resume ${id}`;
    case "cursor":
    case "gemini":
    case "bob":
      return null;
  }
}

export function sessionSupport(s: SessionMeta): SessionResumeSupport[] {
  const support: SessionResumeSupport[] = [];
  if (s.parserSupport === "full") support.push("context");
  else support.push("meta-only");
  if (sessionResumeCommand(s)) support.push("native-resume");
  return support;
}

export function sessionListItem(s: SessionMeta): SessionListItem {
  return {
    ...s,
    displayId: sessionDisplayId(s),
    support: sessionSupport(s),
    resumeCommand: sessionResumeCommand(s),
    contextSlug: s.parserSupport === "full" ? sessionSlug(s) : null,
  };
}

export function sessionDisplayId(s: Pick<SessionMeta, "chatId" | "shortId" | "displayId">): string {
  if (s.displayId) return s.displayId;
  const uuid = s.chatId.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-([0-9a-f]{12})/i);
  if (uuid?.[1]) return uuid[1].slice(0, 8);
  return s.shortId;
}

function shellArg(value: string): string {
  if (/^[A-Za-z0-9._:@/+,\-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** List sessions across every supported agent harness, newest first. */
export async function listSessions(
  opts: { limit?: number; projectFilter?: string; agentFilter?: Agent } = {},
): Promise<SessionMeta[]> {
  const all: SessionMeta[] = [];
  const matchProj = (p: string) =>
    !opts.projectFilter || p.toLowerCase().includes(opts.projectFilter.toLowerCase());
  const wantAgent = (a: Agent) => !opts.agentFilter || opts.agentFilter === a;

  if (wantAgent("claude")) {
    for (const proj of await readdir(CLAUDE_ROOT).catch(() => [])) {
      if (!matchProj(proj)) continue;
      const projPath = join(CLAUDE_ROOT, proj);
      for (const f of await readdir(projPath).catch(() => [])) {
        if (!f.endsWith(".jsonl")) continue;
        const m = await quickMetaJsonl(join(projPath, f), proj, "claude");
        if (m) all.push(m);
      }
    }
  }

  if (wantAgent("pi")) {
    // pi layout: <root>/<cwd>/<ts>_<uuid>.jsonl  (flat per project)
    for (const proj of await readdir(PI_ROOT).catch(() => [])) {
      if (!matchProj(proj)) continue;
      const projPath = join(PI_ROOT, proj);
      for (const f of await readdir(projPath).catch(() => [])) {
        if (!f.endsWith(".jsonl")) continue;
        const m = await quickMetaJsonl(join(projPath, f), proj, "pi");
        if (!m) continue;
        // pi filenames are <ts>_<uuid>.jsonl — use the uuid part as chat id
        const baseId = basename(f, ".jsonl");
        const uuidPart = baseId.split("_").pop();
        if (uuidPart && /[a-f0-9]{6,}/.test(uuidPart)) {
          m.chatId = uuidPart;
          m.shortId = uuidPart.slice(0, 8);
        }
        all.push(m);
      }
    }
  }

  if (wantAgent("codex")) {
    for (const f of await walkCodex()) {
      // Try to pull cwd from session_meta event; fall back to a generic label.
      const cwdHint = await readCodexCwd(f).catch(() => null);
      const proj = cwdHint ?? "codex_global";
      const m = await quickMetaJsonl(f, proj, "codex");
      if (m && cwdHint) m.cwd = cwdHint.replace(/_/g, "/");
      // Apply --project filter to codex sessions (was missing before).
      if (m && matchProj(m.projectDir)) all.push(m);
    }
  }

  if (wantAgent("cursor")) {
    for (const f of await readdir(CURSOR_ROOT).catch(() => [])) {
      if (!matchProj(f)) continue;
      const dir = join(CURSOR_ROOT, f);
      const st = await stat(dir).catch(() => null);
      if (!st || !st.isDirectory()) continue;
      all.push({
        agent: "cursor",
        chatId: f,
        shortId: f.slice(0, 8),
        jsonlPath: dir,
        projectDir: "(cursor)",
        cwd: "",
        title: null,
        startedAt: st.birthtime.toISOString(),
        endedAt: st.mtime.toISOString(),
        lineCount: 0,
        sizeBytes: 0,
        parserSupport: "meta-only",
        usage: null,
      });
    }
  }

  if (wantAgent("gemini")) {
    for (const ws of await readdir(GEMINI_ROOT).catch(() => [])) {
      if (!matchProj(ws)) continue;
      const dir = join(GEMINI_ROOT, ws);
      const st = await stat(dir).catch(() => null);
      if (!st || !st.isDirectory()) continue;
      all.push({
        agent: "gemini",
        chatId: `gemini-${ws}`,
        shortId: ws.slice(0, 8),
        jsonlPath: dir,
        projectDir: ws,
        cwd: "",
        title: ws,
        startedAt: st.birthtime.toISOString(),
        endedAt: st.mtime.toISOString(),
        lineCount: 0,
        sizeBytes: 0,
        parserSupport: "meta-only",
        usage: null,
      });
    }
  }

  if (wantAgent("bob")) {
    // bob layout: ~/.bob/tmp/<projectHash>/chats/session-<ts>-<shortid>.json
    // Each file is a single JSON object: { sessionId, projectHash, startTime,
    // lastUpdated, messages: [{role, content}] }. Format is clean enough for
    // full parser support — see quickMetaBobJson() + loadBobSession().
    for (const hash of await readdir(BOB_ROOT).catch(() => [])) {
      if (hash === "bin") continue; // bob caches helper binaries here
      const chatsDir = join(BOB_ROOT, hash, "chats");
      const chatsStat = await stat(chatsDir).catch(() => null);
      if (!chatsStat || !chatsStat.isDirectory()) continue;
      const files = await readdir(chatsDir).catch(() => []);
      const bobProjectFilter = matchProj(hash) || matchProj(`bob_${hash.slice(0, 12)}`);
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        const filePath = join(chatsDir, f);
        const meta = await quickMetaBobJson(filePath, hash);
        if (!meta) continue;
        if (!bobProjectFilter && !matchProj(meta.chatId)) continue;
        all.push(meta);
      }
    }
  }

  all.sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
  return opts.limit ? all.slice(0, opts.limit) : all;
}

/** Strip Claude-Code rebroadcast prefixes etc. so titles look human. */
function cleanTitle(raw: string): string {
  let s = raw.replace(/\s+/g, " ").trim();
  // Drop common prefixes that aren't the actual ask.
  s = s.replace(/^PREVIOUS AI RESPONSE \(what the user is reacting to\)[:\s]+/i, "");
  s = s.replace(/^CONTEXT:\s*User:\s*/i, "");
  s = s.replace(/^<local-command-[^>]+>[^<]*<\/local-command-[^>]+>\s*/i, "");
  s = s.replace(/^Caveat:[^.]+\.\s*/i, "");
  s = s.replace(/^```[a-z]*\s+/i, "");
  return s.slice(0, 80);
}

async function quickMetaBobJson(jsonPath: string, projectHash: string): Promise<SessionMeta | null> {
  let st;
  try {
    st = await stat(jsonPath);
  } catch {
    return null;
  }
  if (st.size === 0) return null;

  let title: string | null = null;
  let startedAt: string | null = null;
  let endedAt: string | null = null;
  let chatId = basename(jsonPath, ".json");
  let lineCount = 0;
  let cwd = "";
  // Track whether the JSON parse actually succeeded. If it didn't, the
  // session is degraded — list it as `meta-only` so callers (show/resume)
  // know to refuse to load it instead of crashing on a second JSON.parse.
  let jsonParseOk = false;

  try {
    const text = await readFile(jsonPath, "utf8");
    const d = JSON.parse(text);
    jsonParseOk = true;
    if (typeof d.sessionId === "string") chatId = d.sessionId;
    if (typeof d.startTime === "string") startedAt = d.startTime;
    if (typeof d.lastUpdated === "string") endedAt = d.lastUpdated;
    if (typeof d.cwd === "string") cwd = d.cwd;
    if (Array.isArray(d.messages)) {
      lineCount = d.messages.length;
      for (const m of d.messages) {
        // Bob uses `type` as the role field (not `role`).
        if (m?.type === "user" || m?.role === "user") {
          const c = typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content[0]?.text ?? "" : "";
          if (c) {
            title = cleanTitle(String(c));
            break;
          }
        }
      }
    }
  } catch {
    /* malformed JSON — fall back to filesystem metadata, mark degraded */
  }

  return {
    agent: "bob",
    chatId,
    shortId: chatId.slice(0, 8),
    jsonlPath: jsonPath,
    // projectDir is the bare workspace hash; sessionSlug() will prefix with
    // the agent name to avoid double-`bob_bob_` slugs.
    projectDir: projectHash.slice(0, 12),
    cwd,
    title,
    startedAt: startedAt ?? st.birthtime.toISOString(),
    endedAt: endedAt ?? st.mtime.toISOString(),
    lineCount,
    sizeBytes: st.size,
    parserSupport: jsonParseOk ? "full" : "meta-only",
    usage: null,
  };
}

async function readCodexCwd(jsonlPath: string): Promise<string | null> {
  try {
    const text = await readFile(jsonlPath, "utf8");
    const firstLine = text.split("\n", 1)[0];
    if (!firstLine) return null;
    const d = JSON.parse(firstLine);
    const cwd = d?.payload?.cwd ?? d?.payload?.workdir ?? d?.cwd;
    if (typeof cwd === "string" && cwd.startsWith("/")) {
      return cwd
        .replace(/^\/Users\/aryateja\//, "")
        .replace(/^\/+/, "")
        .replace(/[\/]/g, "_")
        .slice(0, 50);
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function walkCodex(): Promise<string[]> {
  const out: string[] = [];
  // Recent (organized by date)
  for (const yr of await readdir(CODEX_ROOT).catch(() => [])) {
    const yrPath = join(CODEX_ROOT, yr);
    for (const mo of await readdir(yrPath).catch(() => [])) {
      const moPath = join(yrPath, mo);
      for (const dy of await readdir(moPath).catch(() => [])) {
        const dyPath = join(moPath, dy);
        for (const f of await readdir(dyPath).catch(() => [])) {
          if (f.endsWith(".jsonl")) out.push(join(dyPath, f));
        }
      }
    }
  }
  // Archive
  for (const f of await readdir(CODEX_ARCHIVE).catch(() => [])) {
    if (f.endsWith(".jsonl")) out.push(join(CODEX_ARCHIVE, f));
  }
  return out;
}

async function quickMetaJsonl(jsonlPath: string, projectDir: string, agent: Agent): Promise<SessionMeta | null> {
  let st;
  try {
    st = await stat(jsonlPath);
  } catch {
    return null;
  }
  if (st.size === 0) return null;

  // Derive chat id depending on agent
  let chatId = basename(jsonlPath, ".jsonl");
  if (agent === "codex") {
    // rollout-2026-04-30T15-27-05-019de080-b8e2-...  -> last uuid
    const m = chatId.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    if (m) chatId = m[1]!;
  }

  const cwd =
    agent === "pi"
      ? projectDir.replace(/^--/, "/").replace(/--$/, "").replace(/-/g, "/").replace(/\/{2,}/g, "/")
      : projectDir.replace(/^-/, "/").replace(/-/g, "/").replace(/\/{2,}/g, "/");

  // Don't read very large files just for meta (>2 MB).
  let title: string | null = null;
  let startedAt: string | null = null;
  let endedAt: string | null = null;
  let firstUserHint: string | null = null;
  let usage: SessionUsage | null = null;
  let model: string | null = null;
  let lineCount = 0;

  if (st.size < 4_000_000) {
    const text = await readFile(jsonlPath, "utf8");
    const lines = text.split("\n").filter(Boolean);
    lineCount = lines.length;
    for (const ln of lines) {
      try {
        const d = JSON.parse(ln);
        if (!startedAt && d.timestamp) startedAt = d.timestamp;
        if (d.timestamp) endedAt = d.timestamp;
        if (!model) {
          const maybeModel =
            d?.payload?.model ??
            d?.payload?.model_slug ??
            d?.turn_context?.payload?.model;
          if (typeof maybeModel === "string" && maybeModel.trim()) model = maybeModel;
        }
        const tokenUsage = readTokenUsageEvent(d, model);
        if (tokenUsage) {
          usage = tokenUsage;
          if (tokenUsage.model) model = tokenUsage.model;
        }
        if (d.type === "ai-title") {
          const t = d.title ?? d.message?.title ?? d.message?.content;
          if (typeof t === "string") title = t;
        }
        if (!firstUserHint && d.type === "user") {
          const c = d.message?.content;
          if (typeof c === "string") firstUserHint = c;
          else if (Array.isArray(c)) {
            for (const x of c) {
              if (x && x.type === "text" && typeof x.text === "string") {
                firstUserHint = x.text;
                break;
              }
            }
          }
        }
      } catch {
        /* skip malformed lines */
      }
    }
  } else {
    // Large file: only count lines roughly via size / 200 avg.
    lineCount = Math.round(st.size / 200);
  }

  if (!title && firstUserHint) {
    title = cleanTitle(firstUserHint);
  }

  return {
    agent,
    chatId,
    shortId: chatId.slice(0, 8),
    displayId: sessionDisplayId({ chatId, shortId: chatId.slice(0, 8) }),
    jsonlPath,
    projectDir,
    cwd,
    title,
    startedAt: startedAt ?? st.birthtime.toISOString(),
    endedAt: endedAt ?? st.mtime.toISOString(),
    lineCount,
    sizeBytes: st.size,
    parserSupport: "full",
    usage,
  };
}

function readTokenUsageEvent(d: any, model: string | null): SessionUsage | null {
  if (d?.type !== "event_msg" || d?.payload?.type !== "token_count") return null;
  const total = d.payload?.info?.total_token_usage;
  if (!total || typeof total !== "object") return null;
  const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    inputTokens: n(total.input_tokens),
    outputTokens: n(total.output_tokens),
    cachedInputTokens: n(total.cached_input_tokens),
    cacheWriteTokens: n(total.cache_write_tokens),
    reasoningOutputTokens: n(total.reasoning_output_tokens),
    totalTokens: n(total.total_tokens),
    costUsd: null,
    model,
    source: "provider-log",
  };
}

/** Resolve a partial chat id (e.g. first 8 chars) to a full session. */
export async function resolveSession(idOrPath: string): Promise<SessionMeta | null> {
  const all = await listSessions({ limit: 10000 });
  const matches = all.filter(
    (s) =>
      s.chatId === idOrPath ||
      s.chatId.startsWith(idOrPath) ||
      s.shortId === idOrPath ||
      sessionDisplayId(s) === idOrPath,
  );
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    // Disambiguate by preferring full parser support over meta-only.
    const full = matches.filter((m) => m.parserSupport === "full");
    if (full.length === 1) return full[0]!;
    throw new Error(
      `Ambiguous id "${idOrPath}" — matches: ${matches
        .slice(0, 5)
        .map((m) => `${m.agent}:${m.shortId}`)
        .join(", ")}`,
    );
  }
  return matches[0]!;
}

/** Parse a session's JSONL into a structured detail object. */
export async function loadSession(meta: SessionMeta): Promise<SessionDetail> {
  // Bob ships one JSON object per session, not JSONL. Route to its loader.
  if (meta.agent === "bob") return loadBobSession(meta);

  const text = await readFile(meta.jsonlPath, "utf8");
  const lines = text.split("\n").filter(Boolean);

  const allUserMessages: string[] = [];
  const assistantTextChunks: string[] = [];
  const toolCounts: Record<string, number> = {};
  const fileWrites = new Map<string, { tool: string; count: number }>();
  let totalAssistantChars = 0;

  for (const ln of lines) {
    let d: any;
    try {
      d = JSON.parse(ln);
    } catch {
      continue;
    }
    const t = d.type;
    const m = d.message ?? {};

    if (t === "user") {
      const c = m.content;
      if (typeof c === "string") allUserMessages.push(c);
      else if (Array.isArray(c)) {
        for (const x of c) {
          if (x && typeof x === "object" && x.type === "text" && typeof x.text === "string") {
            allUserMessages.push(x.text);
          }
        }
      }
    } else if (t === "assistant") {
      const c = m.content;
      if (Array.isArray(c)) {
        for (const x of c) {
          if (!x || typeof x !== "object") continue;
          if (x.type === "text" && typeof x.text === "string") {
            assistantTextChunks.push(x.text);
            totalAssistantChars += x.text.length;
          } else if (x.type === "tool_use") {
            const name = String(x.name ?? "?");
            toolCounts[name] = (toolCounts[name] ?? 0) + 1;
            // Capture file targets for Write/Edit
            const inp = x.input ?? {};
            const path = inp.file_path ?? inp.path ?? inp.target_file;
            if (typeof path === "string" && (name === "Write" || name === "Edit" || name === "MultiEdit")) {
              const cur = fileWrites.get(path) ?? { tool: name, count: 0 };
              fileWrites.set(path, { tool: name, count: cur.count + 1 });
            }
          }
        }
      }
    }
  }

  // Filter user messages: skip ones that are just "PREVIOUS AI RESPONSE" rebroadcasts and very short ones.
  const realUserMessages = allUserMessages.filter(
    (s) => !s.startsWith("PREVIOUS AI RESPONSE") && s.trim().length > 3,
  );

  const filesTouched = Array.from(fileWrites.entries()).map(([path, info]) => ({
    path,
    tool: info.tool,
    count: info.count,
  }));
  filesTouched.sort((a, b) => b.count - a.count);

  const durationMs =
    meta.startedAt && meta.endedAt ? new Date(meta.endedAt).getTime() - new Date(meta.startedAt).getTime() : 0;

  return {
    ...meta,
    firstUserMessage: realUserMessages[0] ?? "",
    lastAssistantText: assistantTextChunks[assistantTextChunks.length - 1] ?? "",
    allUserMessages: realUserMessages,
    assistantTextChunks,
    toolCounts,
    filesTouched,
    totalAssistantChars,
    durationMs,
  };
}

/** Render a session detail as a brain markdown page. */
export function renderSessionPage(d: SessionDetail): string {
  const title = (d.title || d.firstUserMessage.slice(0, 80) || `Session ${sessionDisplayId(d)}`)
    .replace(/\n/g, " ")
    .trim();
  const slug = sessionSlug(d);
  const totalTools = Object.values(d.toolCounts).reduce((a, b) => a + b, 0);
  const minutes = Math.round(d.durationMs / 60000);

  const frontmatter = [
    "---",
    `title: ${title.slice(0, 200)}`,
    `type: session`,
    `agent: ${d.agent}`,
    `chat_id: ${d.chatId}`,
    `short_id: ${d.shortId}`,
    `cwd: ${d.cwd}`,
    `project_dir: ${d.projectDir}`,
    `started: ${d.startedAt ?? ""}`,
    `ended: ${d.endedAt ?? ""}`,
    `duration_min: ${minutes}`,
    `user_turns: ${d.allUserMessages.length}`,
    `assistant_chunks: ${d.assistantTextChunks.length}`,
    `tool_calls: ${totalTools}`,
    `tokens_total: ${d.usage?.totalTokens ?? ""}`,
    `tokens_input: ${d.usage?.inputTokens ?? ""}`,
    `tokens_output: ${d.usage?.outputTokens ?? ""}`,
    `tags: [session, ${d.agent}]`,
    "---",
    "",
  ].join("\n");

  const body: string[] = [];
  body.push(`# ${title}`);
  body.push("");
  body.push(`> ${agentLabel(d.agent)} session \`${sessionDisplayId(d)}\`${d.cwd ? ` · ${d.cwd}` : ""}`);
  body.push(`> ${minutes} min · ${d.allUserMessages.length} user turns · ${totalTools} tool calls`);
  if (d.usage?.totalTokens) {
    body.push(`> ${d.usage.totalTokens.toLocaleString()} tokens logged from ${d.usage.source}`);
  }
  body.push("");

  body.push("## Original task");
  body.push("");
  body.push(quoteBlock(d.firstUserMessage.slice(0, 1500)));
  body.push("");

  if (d.allUserMessages.length > 1) {
    body.push("## All user follow-ups");
    body.push("");
    d.allUserMessages.forEach((m, i) => {
      const oneline = m.replace(/\s+/g, " ").trim().slice(0, 220);
      body.push(`${i + 1}. ${oneline}${m.length > 220 ? "…" : ""}`);
    });
    body.push("");
  }

  if (d.lastAssistantText) {
    body.push("## Last assistant response (tail)");
    body.push("");
    body.push(quoteBlock(d.lastAssistantText.slice(-2000)));
    body.push("");
  }

  if (totalTools > 0) {
    body.push("## Tool usage");
    body.push("");
    Object.entries(d.toolCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([name, count]) => {
        body.push(`- **${name}**: ${count}`);
      });
    body.push("");
  }

  if (d.filesTouched.length > 0) {
    body.push("## Files touched");
    body.push("");
    d.filesTouched.slice(0, 30).forEach((f) => {
      body.push(`- \`${f.path}\` — ${f.tool} ×${f.count}`);
    });
    body.push("");
  }

  body.push("## How to resume");
  body.push("");
  const followUps = Math.max(0, d.allUserMessages.length - 1);
  body.push(`The user was working in \`${d.cwd}\`. Original ask above; ${followUps} follow-ups recorded. Last activity ${d.endedAt}. Read the original task + last assistant tail to recover state.`);
  body.push("");
  body.push(`---`);
  body.push(`*Auto-extracted from \`${d.jsonlPath}\` by \`lescout session\` — slug \`${slug}\`*`);

  return frontmatter + body.join("\n");
}

function agentLabel(a: Agent): string {
  switch (a) {
    case "claude":
      return "Claude Code";
    case "pi":
      return "Pi";
    case "codex":
      return "Codex";
    case "cursor":
      return "Cursor";
    case "gemini":
      return "Gemini";
    case "bob":
      return "Bob Shell";
  }
}

function quoteBlock(s: string): string {
  return s
    .split("\n")
    .map((ln) => `> ${ln}`)
    .join("\n");
}

async function loadBobSession(meta: SessionMeta): Promise<SessionDetail> {
  const text = await readFile(meta.jsonlPath, "utf8");
  const d = JSON.parse(text);

  const allUserMessages: string[] = [];
  const assistantTextChunks: string[] = [];
  const toolCounts: Record<string, number> = {};
  let totalAssistantChars = 0;

  if (Array.isArray(d.messages)) {
    for (const m of d.messages) {
      // Bob uses `type` for role. Treat "bob-shell" as assistant.
      const role = m?.type ?? m?.role;
      const c = typeof m?.content === "string" ? m.content : "";
      if (role === "user" && c.trim().length > 0) {
        allUserMessages.push(c);
      } else if (role === "bob-shell" || role === "assistant") {
        assistantTextChunks.push(c);
        totalAssistantChars += c.length;
        // Bob ships explicit tool calls in `toolCalls: [{ name, args, result }]`.
        if (Array.isArray(m?.toolCalls)) {
          for (const tc of m.toolCalls) {
            const name = String(tc?.name ?? "?");
            toolCounts[name] = (toolCounts[name] ?? 0) + 1;
          }
        }
        // Older transcripts encode them inline as "[using tool <name>:".
        const toolMatches = c.match(/\[using tool ([a-z_]+)/gi) ?? [];
        for (const tm of toolMatches) {
          const name = tm.replace(/^\[using tool /i, "");
          toolCounts[name] = (toolCounts[name] ?? 0) + 1;
        }
      }
    }
  }

  const durationMs =
    meta.startedAt && meta.endedAt
      ? new Date(meta.endedAt).getTime() - new Date(meta.startedAt).getTime()
      : 0;

  return {
    ...meta,
    firstUserMessage: allUserMessages[0] ?? "",
    lastAssistantText: assistantTextChunks[assistantTextChunks.length - 1] ?? "",
    allUserMessages,
    assistantTextChunks,
    toolCounts,
    filesTouched: [],
    totalAssistantChars,
    durationMs,
  };
}

export function sessionSlug(d: SessionMeta): string {
  // gbrain rejects slugs with 4+ slashes. Use exactly 2 slashes.
  // sessions/<agent>_<flat-project>/<date>-<display-id>
  const proj =
    d.projectDir
      .replace(/^-Users-aryateja-/, "")
      .replace(/^-+/, "")
      .replace(/[-/]+/g, "_")
      .replace(/[^a-z0-9_]+/gi, "") // drop parens, dots, anything weird
      .toLowerCase()
      .slice(0, 50) || "unknown";
  const date = (d.startedAt ?? "").slice(0, 10);
  return `sessions/${d.agent}_${proj}/${date}-${sessionDisplayId(d)}`;
}
