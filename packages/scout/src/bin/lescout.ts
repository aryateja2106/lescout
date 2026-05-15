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

async function runSession(rest: string[]): Promise<number> {
  const sub = rest[0];

  if (sub === "list") {
    const limit = getNum(rest, "--limit") ?? 20;
    const projectFilter = getOpt(rest, "--project");
    const agentFilter = getOpt(rest, "--agent") as Agent | undefined;
    const sessions = await listSessions({ limit, projectFilter, agentFilter });

    if (sessions.length === 0) {
      console.log("(no sessions found)");
      return 0;
    }

    const HEAD = ["SHORT", "AGENT", "DATE", "LINES", "PROJECT", "TITLE"];
    const WIDTHS = [10, 8, 12, 8, 32, 0];
    console.log(HEAD.map((h, i) => (WIDTHS[i] ? h.padEnd(WIDTHS[i]) : h)).join(""));
    for (const s of sessions) {
      const date = (s.startedAt ?? "").slice(0, 10);
      const proj = s.projectDir
        .replace(/^-Users-aryateja-/, "")
        .replace(/^-+/, "")
        .replace(/-/g, "/")
        .slice(0, 30);
      const title = (s.title ?? "").replace(/\n/g, " ").trim().slice(0, 60);
      console.log(
        [
          s.shortId.padEnd(WIDTHS[0]!),
          s.agent.padEnd(WIDTHS[1]!),
          date.padEnd(WIDTHS[2]!),
          String(s.lineCount).padEnd(WIDTHS[3]!),
          proj.padEnd(WIDTHS[4]!),
          title,
        ].join(""),
      );
    }
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

const code = await main();
process.exit(code);
