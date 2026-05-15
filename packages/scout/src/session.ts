// session.ts — read Claude Code session JSONLs, extract structure, summarize.
//
// Claude Code stores every session at:
//   ~/.claude/projects/<sanitized-cwd>/<uuid>.jsonl
//
// One line per event. Useful types:
//   user                – user message (text or content[])
//   assistant           – Claude reply (text chunks + tool_use blocks)
//   system              – system messages
//   attachment          – image/file refs
//   ai-title            – auto-generated session title
//   file-history-snapshot, permission-mode, queue-operation – metadata

import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, basename } from "node:path";

const SESSIONS_ROOT = join(homedir(), ".claude", "projects");

export interface SessionMeta {
  chatId: string; // full uuid
  shortId: string; // first 8 chars
  jsonlPath: string;
  projectDir: string; // sanitized cwd as stored by Claude Code
  cwd: string; // unsanitized cwd (best-effort)
  title: string | null;
  startedAt: string | null;
  endedAt: string | null;
  lineCount: number;
  sizeBytes: number;
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

/** List all sessions across all projects, newest first. */
export async function listSessions(opts: { limit?: number; projectFilter?: string } = {}): Promise<SessionMeta[]> {
  const projects = await readdir(SESSIONS_ROOT).catch(() => [] as string[]);
  const all: SessionMeta[] = [];

  for (const proj of projects) {
    if (opts.projectFilter && !proj.toLowerCase().includes(opts.projectFilter.toLowerCase())) continue;
    const projPath = join(SESSIONS_ROOT, proj);
    let files: string[] = [];
    try {
      files = await readdir(projPath);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      const full = join(projPath, f);
      const meta = await quickMeta(full, proj);
      if (meta) all.push(meta);
    }
  }

  all.sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
  return opts.limit ? all.slice(0, opts.limit) : all;
}

async function quickMeta(jsonlPath: string, projectDir: string): Promise<SessionMeta | null> {
  let st;
  try {
    st = await stat(jsonlPath);
  } catch {
    return null;
  }
  if (st.size === 0) return null;

  const chatId = basename(jsonlPath, ".jsonl");
  const cwd = projectDir.replace(/^-/, "/").replace(/-/g, "/").replace(/\/{2,}/g, "/");

  // Best-effort: read first ~64 KB to find title + start, then trail to find end.
  const fd = Bun.file(jsonlPath);
  const text = await fd.text();
  const lines = text.split("\n").filter(Boolean);
  let title: string | null = null;
  let startedAt: string | null = null;
  let endedAt: string | null = null;

  for (const ln of lines) {
    try {
      const d = JSON.parse(ln);
      if (!startedAt && d.timestamp) startedAt = d.timestamp;
      if (d.timestamp) endedAt = d.timestamp;
      if (d.type === "ai-title") {
        const t = d.title ?? d.message?.title ?? d.message?.content;
        if (typeof t === "string") title = t;
      }
    } catch {
      /* skip malformed lines */
    }
  }

  return {
    chatId,
    shortId: chatId.slice(0, 8),
    jsonlPath,
    projectDir,
    cwd,
    title,
    startedAt: startedAt ?? st.birthtime.toISOString(),
    endedAt: endedAt ?? st.mtime.toISOString(),
    lineCount: lines.length,
    sizeBytes: st.size,
  };
}

/** Resolve a partial chat id (e.g. first 8 chars) to a full session path. */
export async function resolveSession(idOrPath: string): Promise<SessionMeta | null> {
  if (idOrPath.endsWith(".jsonl")) {
    const projectDir = basename(idOrPath.replace(/\/[^/]+\.jsonl$/, ""));
    return quickMeta(idOrPath, projectDir);
  }
  const all = await listSessions({ limit: 5000 });
  const matches = all.filter(
    (s) => s.chatId === idOrPath || s.chatId.startsWith(idOrPath) || s.shortId === idOrPath,
  );
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous id "${idOrPath}" — matches: ${matches
        .slice(0, 5)
        .map((m) => m.shortId)
        .join(", ")}`,
    );
  }
  return matches[0]!;
}

/** Parse a session's JSONL into a structured detail object. */
export async function loadSession(meta: SessionMeta): Promise<SessionDetail> {
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
  const title = (d.title ?? d.firstUserMessage.slice(0, 80) ?? `Session ${d.shortId}`).replace(/\n/g, " ").trim();
  const slug = sessionSlug(d);
  const totalTools = Object.values(d.toolCounts).reduce((a, b) => a + b, 0);
  const minutes = Math.round(d.durationMs / 60000);

  const frontmatter = [
    "---",
    `title: ${title.slice(0, 200)}`,
    `type: session`,
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
    `tags: [session, claude-code]`,
    "---",
    "",
  ].join("\n");

  const body: string[] = [];
  body.push(`# ${title}`);
  body.push("");
  body.push(`> Claude Code session \`${d.shortId}\` · ${d.cwd}`);
  body.push(`> ${minutes} min · ${d.allUserMessages.length} user turns · ${totalTools} tool calls`);
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
  body.push(`The user was working in \`${d.cwd}\`. Original ask above; ${d.allUserMessages.length - 1} follow-ups recorded. Last activity ${d.endedAt}. Read the original task + last assistant tail to recover state.`);
  body.push("");
  body.push(`---`);
  body.push(`*Auto-extracted from \`${d.jsonlPath}\` by \`lescout session\` — slug \`${slug}\`*`);

  return frontmatter + body.join("\n");
}

function quoteBlock(s: string): string {
  return s
    .split("\n")
    .map((ln) => `> ${ln}`)
    .join("\n");
}

export function sessionSlug(d: SessionMeta): string {
  // gbrain rejects slugs with 4+ slashes. Flatten the project portion into a
  // single segment so the final slug stays at 2 slashes: sessions/<proj>/<date-id>
  const proj = d.projectDir
    .replace(/^-Users-aryateja-/, "")
    .replace(/^-+/, "")
    .replace(/[-/]+/g, "_")
    .toLowerCase()
    .slice(0, 60);
  const date = (d.startedAt ?? "").slice(0, 10);
  return `sessions/${proj}/${date}-${d.shortId}`;
}
