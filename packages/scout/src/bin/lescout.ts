#!/usr/bin/env bun
// lescout — CLI entry. Hierarchical help, multi-agent session discovery,
// repo/docs ingestion via the sandbox.

import { scoutRepo } from "../repo.ts";
import {
  listSessions,
  resolveSession,
  loadSession,
  renderSessionPage,
  sessionSlug,
  type Agent,
} from "../session.ts";
import { writeToBrain } from "../brain.ts";
import { renderHelp, VERSION } from "../help.ts";
import { buildContext } from "../context.ts";
import { agentColor, bold, dim, gray, smartTruncate, termWidth } from "../format.ts";

function hasFlag(args: string[], ...names: string[]): boolean {
  return args.some((a) => names.includes(a));
}
function getOpt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
}
function getNum(args: string[], name: string): number | undefined {
  const v = getOpt(args, name);
  return v ? Number(v) : undefined;
}

async function main() {
  const args = process.argv.slice(2);

  // -v / --version
  if (args.length === 1 && (args[0] === "-v" || args[0] === "--version")) {
    console.log(VERSION);
    return 0;
  }

  // Top-level help only when there's no command yet.
  if (args.length === 0 || (args.length === 1 && (args[0] === "-h" || args[0] === "--help"))) {
    console.log(renderHelp("__root__"));
    return 0;
  }

  const cmd = args[0];
  const rest = args.slice(1);

  // `lescout help [cmd]`
  if (cmd === "help") {
    console.log(renderHelp(rest[0]));
    return 0;
  }

  // Any subcommand with --help shows that command's help
  if (hasFlag(rest, "-h", "--help")) {
    console.log(renderHelp(cmd));
    return 0;
  }

  // ----- repo -----
  if (cmd === "repo") return runScout(rest, "repo");

  // ----- docs (thin wrapper over repo, different slug + frontmatter) -----
  if (cmd === "docs") return runScout(rest, "docs");

  // ----- session -----
  if (cmd === "session") return runSession(rest);

  // ----- context (caveman-compress) -----
  if (cmd === "context") return runContext(rest);

  console.error(`unknown command: ${cmd}`);
  console.error(`try: lescout help`);
  return 2;
}

async function runScout(rest: string[], kind: "repo" | "docs"): Promise<number> {
  const url = rest.find((a) => !a.startsWith("-"));
  if (!url) {
    console.error(`error: lescout ${kind} <git-url>`);
    return 2;
  }
  const dryRun = rest.includes("--dry-run");
  const timeoutSec = getNum(rest, "--timeout");

  console.log(`▸ scouting ${url} as ${kind}${dryRun ? " (dry-run)" : ""}`);
  const t0 = Date.now();
  try {
    const r = await scoutRepo(url, { dryRun, timeoutSec, kind });
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`✓ done in ${dt}s`);
    console.log(`  slug:      ${r.slug}`);
    console.log(`  run-id:    ${r.runId}`);
    console.log(`  audit-dir: ${r.outDir}`);
    console.log(`  files:     ${r.fileCount}`);
    console.log(`  brain:     ${r.brainWrite.ok ? "ok" : "FAILED"}`);
    if (!r.brainWrite.ok && r.brainWrite.stderr) {
      console.log(`  brain-err: ${r.brainWrite.stderr.slice(0, 200)}`);
    }
    return 0;
  } catch (err) {
    console.error(`✗ failed: ${(err as Error).message.slice(0, 600)}`);
    return 1;
  }
}

async function runContext(rest: string[]): Promise<number> {
  const target = rest.find((a) => !a.startsWith("-"));
  if (!target) {
    console.error("error: lescout context <target>");
    return 2;
  }
  const tokenBudget = getNum(rest, "--tokens") ?? 30000;
  const writeToBrain = !rest.includes("--no-brain");

  console.log(`▸ assembling context bundle for "${target}" (budget ${tokenBudget} tokens)`);
  try {
    const r = await buildContext(target, { tokenBudget, writeToBrain });
    console.log(`✓ done`);
    console.log(`  file:           ${r.outPath}`);
    console.log(`  pages bundled:  ${r.pagesIncluded}`);
    console.log(`  size:           ~${r.estTokens} tokens (${r.estChars} chars)`);
    if (r.brainSlug) console.log(`  brain slug:     ${r.brainSlug}`);
    console.log("");
    console.log(`Load in any agent:`);
    console.log(`  Read ${r.outPath} before answering anything.`);
    if (r.brainSlug) {
      console.log(`Or via brain:`);
      console.log(`  gbrain get ${r.brainSlug}`);
    }
    return 0;
  } catch (err) {
    console.error(`✗ failed: ${(err as Error).message.slice(0, 500)}`);
    return 1;
  }
}

async function runSession(rest: string[]): Promise<number> {
  const sub = rest[0];

  if (sub === "list") {
    const limit = getNum(rest, "--limit") ?? 20;
    const projectFilter = getOpt(rest, "--project");
    const agentFilter = getOpt(rest, "--agent") as Agent | undefined;
    const useTable = rest.includes("--table");
    const sessions = await listSessions({ limit, projectFilter, agentFilter });

    if (sessions.length === 0) {
      console.log(dim("(no sessions found)"));
      return 0;
    }

    const width = termWidth();

    // Auto: card format on narrow terminals; table on wide. --table forces table.
    const wantsTable = useTable || (width >= 140 && !rest.includes("--cards"));
    if (wantsTable) printSessionTable(sessions, width);
    else printSessionCards(sessions, width);
    return 0;
  }

  if (sub === "show" || sub === "resume") {
    const id = rest[1];
    if (!id) {
      console.error(`error: lescout session ${sub} <chat-id>`);
      return 2;
    }
    let meta;
    try {
      meta = await resolveSession(id);
    } catch (err) {
      console.error((err as Error).message);
      return 1;
    }
    if (!meta) {
      console.error(`no session matches "${id}"`);
      return 1;
    }
    if (meta.parserSupport !== "full") {
      console.error(
        `⚠ ${meta.agent} sessions are listed but full parsing is not implemented yet.\n` +
          `  path: ${meta.jsonlPath}`,
      );
      return 1;
    }
    const detail = await loadSession(meta);
    const md = renderSessionPage(detail);
    const slug = sessionSlug(detail);
    if (sub === "show") {
      console.log(md);
      return 0;
    }
    try {
      await writeToBrain(slug, md);
      console.log(`✓ wrote ${slug}`);
      console.log(`  agent:   ${detail.agent}`);
      console.log(`  chat-id: ${detail.chatId}`);
      console.log(`  cwd:     ${detail.cwd}`);
      console.log(
        `  turns:   ${detail.allUserMessages.length} user / ${detail.assistantTextChunks.length} assistant`,
      );
      console.log(`  tools:   ${Object.values(detail.toolCounts).reduce((a, b) => a + b, 0)}`);
      console.log(``);
      console.log(`Query from any agent:  gbrain get ${slug}`);
      const q = (detail.title ?? detail.firstUserMessage.slice(0, 40)).replace(/\n/g, " ");
      console.log(`Or via MCP:            mcp__gbrain__query "${q}"`);
      return 0;
    } catch (err) {
      console.error(`✗ brain write failed: ${(err as Error).message.slice(0, 300)}`);
      return 1;
    }
  }

  console.error(`error: unknown session subcommand: ${sub ?? "(missing)"}`);
  console.error("try: lescout help session");
  return 2;
}

// ----- session list formatters -----

function normalizeProject(projectDir: string): string {
  return projectDir
    .replace(/^-Users-aryateja-/, "")
    .replace(/^-+/, "")
    .replace(/-/g, "/");
}

function printSessionCards(sessions: Awaited<ReturnType<typeof listSessions>>, width: number): void {
  for (const s of sessions) {
    const color = agentColor(s.agent);
    const date = (s.startedAt ?? "").slice(0, 10);
    const proj = normalizeProject(s.projectDir);
    const title = (s.title ?? "").replace(/\n/g, " ").trim();

    // Header line: ● id  agent  date  N lines  project
    const dot = color("●");
    const idCell = bold(s.shortId);
    const agentCell = color(s.agent.padEnd(7));
    const dateCell = dim(date);
    const linesCell = dim(`${String(s.lineCount).padStart(4)} lines`);
    const projCell = gray(proj);
    const head = `${dot} ${idCell}  ${agentCell} ${dateCell}  ${linesCell}  ${projCell}`;
    console.log(head);

    // Title line: indented, dimmed, smart-truncated to terminal width.
    if (title) {
      const titleLine = `  ${smartTruncate(title, Math.max(20, width - 4))}`;
      console.log(dim(titleLine));
    }
  }
  console.log("");
  console.log(
    dim(
      `${sessions.length} sessions · use ——  lescout session list --limit N  ·  --agent claude|pi|codex|cursor|gemini  ·  --table for one-line rows`,
    ),
  );
}

function printSessionTable(sessions: Awaited<ReturnType<typeof listSessions>>, width: number): void {
  // Allocate column widths roughly: short=10 agent=8 date=12 lines=7 project=28 title=rest.
  const shortW = 10;
  const agentW = 8;
  const dateW = 12;
  const linesW = 7;
  const projW = 28;
  const titleW = Math.max(20, width - (shortW + agentW + dateW + linesW + projW));

  // Header: dim, no color
  console.log(
    dim(
      "SHORT".padEnd(shortW) +
        "AGENT".padEnd(agentW) +
        "DATE".padEnd(dateW) +
        "LINES".padEnd(linesW) +
        "PROJECT".padEnd(projW) +
        "TITLE",
    ),
  );

  for (const s of sessions) {
    const color = agentColor(s.agent);
    const date = (s.startedAt ?? "").slice(0, 10);
    const proj = normalizeProject(s.projectDir).slice(0, projW - 2);
    const title = (s.title ?? "").replace(/\n/g, " ").trim();

    // Important: pad BEFORE wrapping in ANSI so width math stays right.
    const shortP = s.shortId.padEnd(shortW);
    const agentP = s.agent.padEnd(agentW);
    const dateP = date.padEnd(dateW);
    const linesP = String(s.lineCount).padEnd(linesW);
    const projP = proj.padEnd(projW);
    const titleT = smartTruncate(title, titleW);

    console.log(`${shortP}${color(agentP)}${dim(dateP)}${linesP}${gray(projP)}${dim(titleT)}`);
  }
}

const code = await main();
process.exit(code);
