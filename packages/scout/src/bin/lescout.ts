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
import {
  listSkills,
  loadSkill,
  suggestSkills,
  renderSkillIndex,
  type SkillScope,
} from "../skills.ts";
import {
  listArtifacts,
  listRoots,
  searchArtifacts,
  type ArtifactType,
} from "../store.ts";

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

  // ----- skills (progressive disclosure) -----
  if (cmd === "skills") return runSkills(rest);

  // ----- store (unified artifact registry; read MVP) -----
  if (cmd === "store") return runStore(rest);

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

async function runStore(rest: string[]): Promise<number> {
  const sub = rest[0];
  const type = getOpt(rest, "--type") as ArtifactType | undefined;
  const agent = getOpt(rest, "--agent");
  const grep = getOpt(rest, "--grep");

  if (sub === "list" || sub === undefined) {
    const items = await listArtifacts({ type, agent: agent ?? undefined, grep: grep ?? undefined });
    if (items.length === 0) {
      console.log(dim("(no artifacts found)"));
      return 0;
    }
    const width = termWidth();
    const typeW = 10;
    const idW = 28;
    const scopeW = 10;
    const descW = Math.max(20, width - (typeW + idW + scopeW));
    console.log(dim("TYPE".padEnd(typeW) + "ID".padEnd(idW) + "SCOPE".padEnd(scopeW) + "DESCRIPTION"));
    for (const a of items) {
      console.log(
        dim(a.type.padEnd(typeW)) +
          bold(a.id.slice(0, idW - 1).padEnd(idW)) +
          dim(a.scope.padEnd(scopeW)) +
          smartTruncate(a.description, descW),
      );
    }
    console.log("");
    console.log(
      dim(
        `${items.length} artifacts · use —— --type skill|mcp|hook|plugin|extension · --agent <name> · --grep <s> · lescout store info <id>`,
      ),
    );
    return 0;
  }

  if (sub === "info") {
    const id = rest[1];
    if (!id) {
      console.error("error: lescout store info <id>");
      return 2;
    }
    const items = await listArtifacts();
    const m = items.find((a) => a.id === id) ?? items.find((a) => a.id.startsWith(id));
    if (!m) {
      console.error(`no artifact matches "${id}"`);
      return 1;
    }
    console.log(`${bold(m.id)}  ${dim(`(${m.type}·${m.scope}·${m.version ?? "—"})`)}`);
    console.log(dim(m.path));
    console.log("");
    console.log(m.description);
    console.log("");
    if (m.bodyTokensApprox > 0) console.log(dim(`tokens: ~${m.bodyTokensApprox}`));
    if (Object.keys(m.extras).length > 0) {
      console.log(dim(`extras:`));
      for (const [k, v] of Object.entries(m.extras)) {
        console.log(dim(`  ${k}: ${JSON.stringify(v)}`));
      }
    }
    return 0;
  }

  if (sub === "search") {
    const q = rest.slice(1).filter((a) => !a.startsWith("-")).join(" ");
    if (!q) {
      console.error("error: lescout store search <query>");
      return 2;
    }
    const limit = getNum(rest, "--limit") ?? 8;
    const top = await searchArtifacts(q, limit, { type, agent: agent ?? undefined });
    if (top.length === 0) {
      console.log(dim(`(no artifact matched "${q}")`));
      return 0;
    }
    for (const a of top) {
      console.log(`${bold(a.id.padEnd(28))} ${dim(`[${a.type}]`.padEnd(12))} ${dim(`score=${a.score}`)}  ${dim(`(${a.scope})`)}`);
      console.log(`  ${smartTruncate(a.description, Math.max(40, termWidth() - 4))}`);
      console.log("");
    }
    return 0;
  }

  if (sub === "roots") {
    const roots = await listRoots();
    console.log(dim("TYPE".padEnd(12) + "SCOPE".padEnd(10) + "EXISTS".padEnd(8) + "PATH"));
    for (const r of roots) {
      console.log(
        dim(r.type.padEnd(12)) +
          dim(r.scope.padEnd(10)) +
          (r.exists ? dim("  yes  ") : dim("  no   ")) +
          r.path,
      );
    }
    return 0;
  }

  console.error(`error: unknown store subcommand: ${sub ?? "(missing)"}`);
  console.error("try: lescout help store");
  return 2;
}

async function runSkills(rest: string[]): Promise<number> {
  const sub = rest[0];

  if (sub === "list" || sub === undefined) {
    const scopeArg = getOpt(rest, "--scope") as SkillScope | undefined;
    const grep = getOpt(rest, "--grep");
    const wantsBrain = rest.includes("--brain");
    const useTable = rest.includes("--table");
    const skills = await listSkills({ scope: scopeArg, grep });

    if (skills.length === 0) {
      console.log(dim("(no skills found)"));
      return 0;
    }

    if (wantsBrain) {
      const md = renderSkillIndex(skills);
      const date = new Date().toISOString().slice(0, 10);
      const slug = `skills/index/${date}`;
      try {
        await writeToBrain(slug, md);
        console.log(`✓ wrote ${slug} (${skills.length} skills)`);
      } catch (err) {
        console.error(`✗ brain write failed: ${(err as Error).message.slice(0, 200)}`);
        return 1;
      }
      return 0;
    }

    const width = termWidth();
    if (useTable || width >= 140) {
      printSkillTable(skills, width);
    } else {
      printSkillCards(skills, width);
    }
    return 0;
  }

  if (sub === "show") {
    const name = rest[1];
    if (!name) {
      console.error("error: lescout skills show <name>");
      return 2;
    }
    const detail = await loadSkill(name).catch((e: Error) => {
      console.error(`error: ${e.message}`);
      return null;
    });
    if (!detail) {
      console.error(`no skill matches "${name}"`);
      return 1;
    }
    console.log(`${bold(detail.name)}  ${dim(`(${detail.scope}·${detail.version ?? "unversioned"})`)}`);
    console.log(`${dim(detail.path)}`);
    console.log("");
    console.log(detail.description);
    console.log("");
    console.log(
      dim(
        `body: ${(detail.bodySize / 1024).toFixed(1)} KB · ~${detail.bodyTokensApprox} tokens · license=${detail.license ?? "—"} · allowed-tools=[${detail.allowedTools.join(", ") || "—"}]`,
      ),
    );
    console.log("");
    console.log(dim(`Load body with:  lescout skills load ${detail.name}`));
    return 0;
  }

  if (sub === "load") {
    const name = rest[1];
    if (!name) {
      console.error("error: lescout skills load <name>");
      return 2;
    }
    const detail = await loadSkill(name).catch((e: Error) => {
      console.error(`error: ${e.message}`);
      return null;
    });
    if (!detail) {
      console.error(`no skill matches "${name}"`);
      return 1;
    }
    process.stdout.write(detail.body);
    process.stdout.write("\n");
    return 0;
  }

  if (sub === "suggest") {
    const task = rest.slice(1).filter((a) => !a.startsWith("-")).join(" ");
    if (!task) {
      console.error("error: lescout skills suggest <task description>");
      return 2;
    }
    const limit = getNum(rest, "--limit") ?? 5;
    const top = await suggestSkills(task, limit);
    if (top.length === 0) {
      console.log(dim(`(no skill matched "${task}")`));
      return 0;
    }
    for (const s of top) {
      console.log(`${bold(s.name.padEnd(28))} ${dim(`score=${s.score}`)}  ${dim(`(${s.scope})`)}`);
      console.log(`  ${smartTruncate(s.description, Math.max(40, termWidth() - 4))}`);
      console.log(dim(`  load:  lescout skills load ${s.name}`));
      console.log("");
    }
    return 0;
  }

  console.error(`error: unknown skills subcommand: ${sub ?? "(missing)"}`);
  console.error("try: lescout help skills");
  return 2;
}

function printSkillCards(skills: Array<Awaited<ReturnType<typeof listSkills>>[number]>, width: number): void {
  for (const s of skills) {
    const dot = ({
      pi: gray,
      shared: gray,
      claude: gray,
      extra: gray,
    }[s.scope] ?? gray)("○");
    const sizeCell = dim(`~${s.bodyTokensApprox.toString().padStart(5)}t`);
    const head = `${dot} ${bold(s.name.padEnd(28))} ${dim(s.scope.padEnd(7))} ${sizeCell}`;
    console.log(head);
    if (s.description) {
      console.log(dim(`  ${smartTruncate(s.description, Math.max(20, width - 4))}`));
    }
  }
  console.log("");
  console.log(
    dim(
      `${skills.length} skills · use ——  lescout skills show <name>  ·  lescout skills load <name>  ·  --scope pi|shared|claude|extra  ·  --grep <s>`,
    ),
  );
}

function printSkillTable(skills: Array<Awaited<ReturnType<typeof listSkills>>[number]>, width: number): void {
  const nameW = 28;
  const scopeW = 8;
  const sizeW = 8;
  const descW = Math.max(20, width - (nameW + scopeW + sizeW));
  console.log(
    dim("NAME".padEnd(nameW) + "SCOPE".padEnd(scopeW) + "TOKENS".padEnd(sizeW) + "DESCRIPTION"),
  );
  for (const s of skills) {
    const tokens = `~${s.bodyTokensApprox}t`;
    console.log(
      bold(s.name.padEnd(nameW)) +
        dim(s.scope.padEnd(scopeW)) +
        dim(tokens.padEnd(sizeW)) +
        smartTruncate(s.description, descW),
    );
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
