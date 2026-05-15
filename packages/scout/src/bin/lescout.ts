#!/usr/bin/env bun
// lescout — CLI entry. Minimal arg parsing; we add yargs/commander only when
// command-count justifies it.

import { scoutRepo } from "../repo.ts";

const VERSION = "0.0.1";

function usage(): never {
  console.log(`lescout ${VERSION} — Less Scout, More Context

USAGE
  lescout repo <git-url> [--dry-run] [--timeout SEC]
  lescout --version
  lescout --help

EXAMPLES
  lescout repo https://github.com/safishamsi/graphify
  lescout repo https://github.com/rowboatlabs/rowboat --dry-run

Phase-1 commands only: more (search, grok, today, ask) land in later phases.
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
