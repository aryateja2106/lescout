// help.ts — structured help texts. Agents call `lescout help` or
// `lescout <cmd> --help` to self-discover capabilities.
//
// Format philosophy: tight enough an agent can scan it in 200 tokens,
// rich enough a human gets every flag and example. Killer flow always
// appears in the root help, no scrolling required.

export const VERSION = "0.0.7";

interface CommandHelp {
  synopsis: string;
  usage: string[];
  description: string;
  flags?: Array<{ flag: string; desc: string }>;
  examples?: Array<{ cmd: string; what?: string }>;
  seeAlso?: string[];
  exitCodes?: Array<{ code: number; meaning: string }>;
}

// ───────────────────────────── command catalog ─────────────────────────────

const COMMANDS: Record<string, CommandHelp> = {
  context: {
    synopsis: "Bundle brain knowledge about a target into one dense file",
    usage: ["lescout context <target> [--tokens N] [--no-brain]"],
    description: `Hybrid-search the brain for <target>, dedup hits across pages /
repos / sessions / notes, fetch full bodies for top scorers, render into ONE
markdown file under a token budget.

Output: ~/.lescout/context/<target>-<date>.md
Brain : context/<target>/<date>   (skip with --no-brain)

The killer flow: a fresh agent on a new chat reads ONE file instead of
re-deriving context. Run before every cold start.`,
    flags: [
      { flag: "--tokens N", desc: "Token budget (default 30000, ~4 chars/token)" },
      { flag: "--no-brain", desc: "Write the file but skip the brain write-back" },
    ],
    examples: [
      { cmd: "lescout context lockshell" },
      { cmd: "lescout context lesearch --tokens 50000" },
      { cmd: "lescout context agentmemory --no-brain" },
    ],
    seeAlso: ["lescout help repo", "lescout help session", "gbrain query <topic>"],
  },

  repo: {
    synopsis: "Sandbox-scout a git repository into the brain",
    usage: ["lescout repo <git-url> [--dry-run] [--timeout SEC]"],
    description: `Clones a repository inside a hardened Docker sandbox:
--read-only · --cap-drop ALL · --no-new-privileges · --memory 1g · user=1000.

Inside the container: shallow clone (--depth 1, hooksPath disabled), then
extract tree, manifests, READMEs, AGENTS.md, CLAUDE.md, todos. No npm/pip/
cargo install ever runs. Only structured text crosses the boundary.

Brain slug: repos/<host>/<owner>/<name>
Audit dir : ~/.lescout/runs/<run-id>/

Allowed hosts: github.com, gitlab.com, bitbucket.org, codeberg.org, git.sr.ht.`,
    flags: [
      { flag: "--dry-run", desc: "Extract artifacts but skip the brain write" },
      { flag: "--timeout SEC", desc: "Container timeout in seconds (default 120)" },
    ],
    examples: [
      { cmd: "lescout repo https://github.com/safishamsi/graphify" },
      { cmd: "lescout repo https://github.com/rohitg00/agentmemory --dry-run" },
    ],
    seeAlso: ["lescout help docs"],
    exitCodes: [
      { code: 0, meaning: "Repository scouted and written to brain" },
      { code: 1, meaning: "Sandbox or brain write failed" },
      { code: 2, meaning: "Missing or invalid <git-url> argument" },
    ],
  },

  docs: {
    synopsis: "Sandbox-scout official docs from a GitHub repo (URL doc sites: Phase 2)",
    usage: ["lescout docs <github-url> [--dry-run]"],
    description: `Like \`lescout repo\` but optimized for documentation hierarchies.

Pulls README.md · AGENTS.md · CLAUDE.md · ARCHITECTURE.md · CONTRIBUTING.md ·
docs/**/*.md and manifests. Brain page tagged type=docs, slug docs/<host>/
<owner>/<name>.

Non-GitHub URLs (official doc sites with sitemap.xml) land in Phase 2 via
\`lescout grok\`.`,
    flags: [{ flag: "--dry-run", desc: "Extract but skip brain write" }],
    examples: [
      { cmd: "lescout docs https://github.com/colinhacks/zod" },
      { cmd: "lescout docs https://github.com/tc39/proposal-pipeline-operator" },
    ],
    seeAlso: ["lescout help repo"],
    exitCodes: [
      { code: 0, meaning: "Docs scouted and written to brain" },
      { code: 1, meaning: "Fetch / extract failed" },
      { code: 2, meaning: "Unsupported URL (non-GitHub) — wait for Phase 2 grok" },
    ],
  },

  session: {
    synopsis: "List / show / resume coding-agent sessions across all harnesses",
    usage: [
      "lescout session list [--limit N] [--project SUBSTR] [--agent NAME]",
      "lescout session show <chat-id>",
      "lescout session resume <chat-id>",
    ],
    description: `Walks every on-disk session store LeScout knows about and shows
a unified view across Claude Code · pi · Codex · Cursor · Gemini.

  list   – newest-first table, columns: SHORT · AGENT · DATE · LINES · PROJECT · TITLE
  show   – print a brain-ready summary of one session to stdout
  resume – write that summary into the brain so any agent can pick up

Brain slug: sessions/<flat-project>/<date>-<short-id> (gbrain caps at 2 slashes).`,
    flags: [
      { flag: "--limit N", desc: "Cap results (default 20)" },
      { flag: "--project SUBSTR", desc: "Filter by cwd substring (case-insensitive)" },
      { flag: "--agent NAME", desc: "Filter: claude|pi|codex|cursor|gemini" },
      { flag: "--table", desc: "One-line table (default: card view on narrow terms)" },
      { flag: "--cards", desc: "Force card view (default on terminals < 140 cols)" },
    ],
    examples: [
      { cmd: "lescout session list --limit 10" },
      { cmd: "lescout session list --project lescout --agent claude" },
      { cmd: "lescout session resume c1a443ce" },
    ],
    seeAlso: ["lescout help context"],
    exitCodes: [
      { code: 0, meaning: "ok" },
      { code: 1, meaning: "no match or write failed" },
      { code: 2, meaning: "bad args" },
    ],
  },

  help: {
    synopsis: "Show this help, or detailed help for one command",
    usage: ["lescout help", "lescout help <command>", "lescout <command> --help"],
    description: "Man-style help. Designed so an agent grepping --help gets enough to act.",
    examples: [
      { cmd: "lescout help" },
      { cmd: "lescout help context" },
      { cmd: "lescout context --help" },
    ],
  },
};

const COMMAND_ORDER = ["context", "repo", "docs", "session", "help"];

// ────────────────────────────── renderers ──────────────────────────────────

export function renderHelp(cmd?: string): string {
  if (!cmd || cmd === "__root__") return renderRoot();
  const h = COMMANDS[cmd];
  if (!h) return `lescout: no help for "${cmd}". Try: lescout help`;
  return renderCommand(cmd, h);
}

function renderRoot(): string {
  const lines: string[] = [];
  lines.push(`lescout ${VERSION} — sandboxed scouting + caveman-compress for every agent`);
  lines.push(`Part of LeSearch AI · Less Search, More Agents`);
  lines.push("");
  lines.push("USAGE");
  lines.push("  lescout <command> [args]        lescout <command> --help");
  lines.push("  lescout help [command]          lescout --version");
  lines.push("");
  lines.push("COMMANDS");
  for (const name of COMMAND_ORDER) {
    const h = COMMANDS[name];
    if (!h) continue;
    lines.push(`  ${name.padEnd(9)} ${h.synopsis}`);
  }
  lines.push("");
  lines.push("COMMON FLOWS  copy-paste ready");
  lines.push("  # See every session across claude / pi / codex / cursor / gemini");
  lines.push("  $ lescout session list                          # last 20, all agents");
  lines.push("  $ lescout session list --agent claude           # filter by agent");
  lines.push("  $ lescout session list --project lescout        # filter by cwd");
  lines.push("  $ lescout session resume <8-char-id>            # rehydrate into brain");
  lines.push("");
  lines.push("  # Caveman-compress: dense context for a fresh agent");
  lines.push("  $ lescout context <target>                      # → ~/.lescout/context/<target>-<date>.md");
  lines.push("  # In any new chat: 'Read <that file> before answering.'");
  lines.push("");
  lines.push("  # Sandbox-scout a repo or docs URL into the brain");
  lines.push("  $ lescout repo  https://github.com/<owner>/<repo>");
  lines.push("  $ lescout docs  https://github.com/<owner>/<repo>");
  lines.push("");
  lines.push("FLAGS");
  lines.push("  -h, --help        Print help and exit");
  lines.push("  -v, --version     Print version and exit");
  lines.push("");
  lines.push("MORE  lescout help <command>");
  lines.push("      https://github.com/aryateja2106/lescout");
  return lines.join("\n");
}

function renderCommand(name: string, h: CommandHelp): string {
  const lines: string[] = [];
  lines.push(`lescout ${name} — ${h.synopsis}`);
  lines.push("");

  lines.push("USAGE");
  for (const u of h.usage) lines.push(`  ${u}`);
  lines.push("");

  lines.push("DESCRIPTION");
  for (const l of h.description.split("\n")) lines.push(`  ${l}`);
  lines.push("");

  if (h.flags?.length) {
    lines.push("FLAGS");
    const pad = Math.max(...h.flags.map((f) => f.flag.length)) + 2;
    for (const f of h.flags) lines.push(`  ${f.flag.padEnd(pad)} ${f.desc}`);
    lines.push("");
  }

  if (h.examples?.length) {
    lines.push("EXAMPLES");
    for (const e of h.examples) {
      lines.push(`  $ ${e.cmd}`);
      if (e.what) lines.push(`    ${e.what}`);
    }
    lines.push("");
  }

  if (h.exitCodes?.length) {
    lines.push("EXIT CODES");
    for (const c of h.exitCodes) lines.push(`  ${String(c.code).padEnd(3)} ${c.meaning}`);
    lines.push("");
  }

  if (h.seeAlso?.length) {
    lines.push("SEE ALSO  " + h.seeAlso.join(" · "));
  }

  return lines.join("\n").trimEnd();
}
