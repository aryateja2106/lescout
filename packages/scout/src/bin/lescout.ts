#!/usr/bin/env bun
// lescout — CLI entry. Minimal arg parsing; we add yargs/commander only when
// command-count justifies it.

import { scoutRepo } from "../repo.ts";
import { listSessions, resolveSession, loadSession, renderSessionPage, sessionSlug } from "../session.ts";
import { writeToBrain } from "../brain.ts";

const VERSION = "0.0.2";

function usage(): never {
  console.log(`lescout ${VERSION} — Less Scout, More Context

USAGE
  lescout repo <git-url> [--dry-run] [--timeout SEC]
  lescout session list [--limit N] [--project SUBSTR]
  lescout session show <chat-id>           Print summary to stdout
  lescout session resume <chat-id>         Write summary to brain, print slug
  lescout --version | --help

EXAMPLES
  lescout repo https://github.com/safishamsi/graphify
  lescout session list --limit 10
  lescout session resume c1a443ce   # short id is fine
`);
  process.exit(0);
}

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === "-h" || args[0] === "--help") usage();
if (args[0] === "-v" || args[0] === "--version") {
  console.log(VERSION);
  process.exit(0);
}

const cmd = args[0];
const rest = args.slice(1);

async function main() {
  if (cmd === "session") {
    const sub = rest[0];
    if (sub === "list") {
      const lim = rest.indexOf("--limit");
      const limit = lim >= 0 && rest[lim + 1] ? Number(rest[lim + 1]) : 20;
      const pf = rest.indexOf("--project");
      const projectFilter = pf >= 0 ? rest[pf + 1] : undefined;
      const sessions = await listSessions({ limit, projectFilter });
      if (sessions.length === 0) {
        console.log("(no sessions found)");
        process.exit(0);
      }
      console.log(`${"SHORT".padEnd(10)}${"DATE".padEnd(12)}${"LINES".padEnd(8)}${"PROJECT".padEnd(40)}TITLE`);
      for (const s of sessions) {
        const date = (s.startedAt ?? "").slice(0, 10);
        const proj = s.projectDir.replace(/^-Users-aryateja-/, "").replace(/-/g, "/").slice(0, 38);
        const title = (s.title ?? "").replace(/\n/g, " ").slice(0, 60);
        console.log(`${s.shortId.padEnd(10)}${date.padEnd(12)}${String(s.lineCount).padEnd(8)}${proj.padEnd(40)}${title}`);
      }
      process.exit(0);
    }
    if (sub === "show" || sub === "resume") {
      const id = rest[1];
      if (!id) {
        console.error(`error: lescout session ${sub} <chat-id>`);
        process.exit(2);
      }
      const meta = await resolveSession(id);
      if (!meta) {
        console.error(`no session matches "${id}"`);
        process.exit(1);
      }
      const detail = await loadSession(meta);
      const md = renderSessionPage(detail);
      const slug = sessionSlug(detail);
      if (sub === "show") {
        console.log(md);
        process.exit(0);
      }
      // resume → write to brain
      try {
        await writeToBrain(slug, md);
        console.log(`✓ wrote ${slug}`);
        console.log(`  chat-id: ${detail.chatId}`);
        console.log(`  cwd:     ${detail.cwd}`);
        console.log(`  turns:   ${detail.allUserMessages.length} user / ${detail.assistantTextChunks.length} assistant`);
        console.log(`  tools:   ${Object.values(detail.toolCounts).reduce((a,b)=>a+b,0)}`);
        console.log(``);
        console.log(`Query from any agent:  gbrain get ${slug}`);
        console.log(`Or via MCP:            mcp__gbrain__query "${(detail.title ?? detail.firstUserMessage.slice(0,40)).replace(/\n/g,' ')}"`);
        process.exit(0);
      } catch (err) {
        console.error(`✗ brain write failed: ${(err as Error).message.slice(0, 300)}`);
        process.exit(1);
      }
    }
    console.error(`error: unknown session subcommand: ${sub}`);
    usage();
  }

  if (cmd === "repo") {
    const url = rest.find((a) => !a.startsWith("-"));
    if (!url) {
      console.error("error: lescout repo <git-url>");
      process.exit(2);
    }
    const dryRun = rest.includes("--dry-run");
    const timeoutIdx = rest.indexOf("--timeout");
    const timeoutSec = timeoutIdx >= 0 && rest[timeoutIdx + 1] ? Number(rest[timeoutIdx + 1]) : undefined;

    console.log(`▸ scouting ${url} ${dryRun ? "(dry-run)" : ""}`);
    const t0 = Date.now();
    try {
      const r = await scoutRepo(url, { dryRun, timeoutSec });
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
      process.exit(0);
    } catch (err) {
      console.error(`✗ failed: ${(err as Error).message}`);
      process.exit(1);
    }
  } else {
    console.error(`unknown command: ${cmd}`);
    usage();
  }
}

main();
