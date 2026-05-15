// help.ts — structured help texts. Agents call `lescout help` or
// `lescout <cmd> --help` to self-discover capabilities.

export const VERSION = "0.0.4";

interface CommandHelp {
  synopsis: string;
  usage: string[];
  description: string;
  flags?: Array<{ flag: string; desc: string }>;
  examples?: Array<{ cmd: string; what: string }>;
  seeAlso?: string[];
  exitCodes?: Array<{ code: number; meaning: string }>;
}

const COMMANDS: Record<string, CommandHelp> = {
  context: {
    synopsis: "Caveman-compress: gather everything about a target into one dense file",
    usage: ["lescout context <target> [--tokens N] [--no-brain]"],
    description: `Hybrid-search across your GBrain for a target (project name, repo, topic)
and assemble the most relevant pages, repos, sessions, and concepts into ONE
compact markdown bundle under a token budget.

Use case: fresh agent (Claude / Cursor / Codex / Gemini) starts on project X.
Instead of re-explaining, run \`lescout context X\` and load the resulting file
as the first message. Dense context, no bloat.

Written to:
  ~/.lescout/context/<target>-<date>.md
And by default to the brain at:
  context/<target>/<date>
so every other agent can fetch via gbrain query or mcp__gbrain__query.`,
    flags: [
      { flag: "--tokens N", desc: "Token budget (default 30000)" },
      { flag: "--no-brain", desc: "Skip writing the bundle back to the brain" },
    ],
    examples: [
      { cmd: "lescout context lockshell", what: "30K-token bundle on lockshell" },
      { cmd: "lescout context lesearch --tokens 50000", what: "Bigger budget for bigger project" },
      { cmd: "lescout context agentmemory --no-brain", what: "Local file only, skip brain write" },
    ],
    seeAlso: ["lescout help repo", "lescout help session"],
  },

  __root__: {
    synopsis: "Less Scout, More Context — sandboxed scouting + brain-backed retrieval for every agent",
    usage: [
      "lescout <command> [args]",
      "lescout help [command]",
      "lescout <command> --help",
      "lescout --version",
    ],
    description: `LeScout is a personal knowledge stack that follows you across machines and feeds every agent harness (pi, Claude Code, Cursor, Codex, Gemini, Amp).

It has two halves:
  1. SCOUT  — sandboxed ingestion: repos, URLs, docs, sessions. Foreign code
              never executes on the host. Only structured text crosses the
              container boundary.
  2. BRAIN  — hybrid-search retrieval (currently via GBrain MCP). Queryable
              by any agent. Sessions resume from chat-id.`,
    flags: [
      { flag: "-h, --help", desc: "Print this help and exit" },
      { flag: "-v, --version", desc: "Print version and exit" },
    ],
    seeAlso: ["lescout help repo", "lescout help session", "lescout help docs"],
  },

  repo: {
    synopsis: "Sandboxed ingestion of a git repository into the brain",
    usage: ["lescout repo <git-url> [--dry-run] [--timeout SEC]"],
    description: `Clones a git repository inside a hardened Docker sandbox
(--read-only, --cap-drop ALL, --no-new-privileges, --memory 1g, network=bridge,
user=1000:1000). Inside the container: git clone --depth 1 --no-tags
--no-recurse-submodules with hooksPath disabled, then extracts tree, manifests,
READMEs, AGENTS.md, CLAUDE.md, todos. NO npm/pip/cargo install ever runs.

The extracted text is rendered as a markdown brain page (slug:
repos/<host>/<owner>/<name>) and written via gbrain put. A full audit envelope
lives at ~/.lescout/runs/<run-id>/.

Allowed hosts: github.com, gitlab.com, bitbucket.org, codeberg.org, git.sr.ht.`,
    flags: [
      { flag: "--dry-run", desc: "Extract artifacts but skip the brain write" },
      { flag: "--timeout SEC", desc: "Container timeout in seconds (default 120)" },
    ],
    examples: [
      { cmd: "lescout repo https://github.com/safishamsi/graphify", what: "Standard scout + write to brain" },
      { cmd: "lescout repo https://github.com/rohitg00/agentmemory --dry-run", what: "Inspect artifacts only" },
    ],
    seeAlso: ["lescout help docs", "gbrain query <topic>"],
    exitCodes: [
      { code: 0, meaning: "Repository scouted and written to brain" },
      { code: 1, meaning: "Sandbox or brain write failed (stderr has detail)" },
      { code: 2, meaning: "Missing or invalid <git-url> argument" },
    ],
  },

  docs: {
    synopsis: "Ingest official documentation from a GitHub repo or doc site",
    usage: ["lescout docs <github-url-or-doc-site> [--dry-run]"],
    description: `Like \`lescout repo\` but optimized for documentation hierarchies.

Today: GitHub URLs are supported. The sandbox clones the repo and pulls
README.md / AGENTS.md / CLAUDE.md / ARCHITECTURE.md / CONTRIBUTING.md /
docs/*.md / manifests, then tags the brain page as type=docs.

Coming in Phase 2: non-GitHub URLs (official doc sites) via \`lescout grok\`
with sitemap.xml parsing, similar in spirit to Context7's curated doc index.`,
    flags: [
      { flag: "--dry-run", desc: "Extract but skip brain write" },
    ],
    examples: [
      { cmd: "lescout docs https://github.com/colinhacks/zod", what: "Ingest zod README + docs" },
      { cmd: "lescout docs https://github.com/tc39/proposal-pipeline-operator", what: "Ingest a spec repo" },
    ],
    seeAlso: ["lescout help repo"],
    exitCodes: [
      { code: 0, meaning: "Docs scouted and written to brain" },
      { code: 1, meaning: "Fetch/extract failed" },
      { code: 2, meaning: "Unsupported URL (non-GitHub) — wait for Phase 2 grok" },
    ],
  },

  session: {
    synopsis: "Discover and resume coding-agent sessions across harnesses",
    usage: [
      "lescout session list [--limit N] [--project SUBSTR] [--agent NAME]",
      "lescout session show <chat-id>",
      "lescout session resume <chat-id>",
    ],
    description: `Walks the on-disk session stores for every agent harness
LeScout knows about (Claude Code, pi, Codex, Cursor, Gemini) and produces a
unified view.

  list   - newest-first table of recent sessions, with AGENT column
  show   - print a brain-ready summary of one session to stdout
  resume - write that summary into the brain so any agent can pick up

Slugs land at sessions/<flat-project>/<date>-<short-id>. Two slashes only —
gbrain rejects deeper.`,
    flags: [
      { flag: "--limit N", desc: "Cap results (default 20)" },
      { flag: "--project SUBSTR", desc: "Filter by cwd substring (case-insensitive)" },
      { flag: "--agent NAME", desc: "Filter by agent: claude|pi|codex|cursor|gemini" },
    ],
    examples: [
      { cmd: "lescout session list --limit 10", what: "Last 10 sessions across all agents" },
      { cmd: "lescout session list --project lescout --agent claude", what: "Claude sessions in lescout/" },
      { cmd: "lescout session resume c1a443ce", what: "Resume by 8-char prefix" },
    ],
    seeAlso: ["lescout help repo"],
    exitCodes: [
      { code: 0, meaning: "ok" },
      { code: 1, meaning: "no match or write failed" },
      { code: 2, meaning: "bad args" },
    ],
  },

  help: {
    synopsis: "Print structured help for any command",
    usage: ["lescout help", "lescout help <command>"],
    description: "Prints man-style help suitable for both humans and agents that grep through --help output.",
    examples: [
      { cmd: "lescout help", what: "Full reference" },
      { cmd: "lescout help repo", what: "Just the repo subcommand" },
    ],
  },
};

export function renderHelp(cmd?: string): string {
  const sections: string[] = [];
  if (!cmd || cmd === "__root__") {
    const root = COMMANDS.__root__!;
    sections.push(`lescout ${VERSION} — ${root.synopsis}`);
    sections.push("");
    sections.push("USAGE");
    root.usage.forEach((u) => sections.push(`  ${u}`));
    sections.push("");
    sections.push("DESCRIPTION");
    root.description.split("\n").forEach((l) => sections.push(`  ${l}`));
    sections.push("");
    sections.push("COMMANDS");
    Object.entries(COMMANDS).forEach(([name, h]) => {
      if (name === "__root__") return;
      sections.push(`  ${name.padEnd(10)} ${h.synopsis}`);
    });
    sections.push("");
    if (root.flags) {
      sections.push("FLAGS");
      root.flags.forEach((f) => sections.push(`  ${f.flag.padEnd(18)} ${f.desc}`));
      sections.push("");
    }
    sections.push("EXAMPLES");
    sections.push("  lescout repo https://github.com/safishamsi/graphify");
    sections.push("  lescout session list --limit 10");
    sections.push("  lescout session resume c1a443ce");
    sections.push("  lescout docs https://github.com/colinhacks/zod");
    sections.push("");
    sections.push("SEE ALSO");
    sections.push("  lescout help <command>   — detailed help for one command");
    sections.push("  ~/Projects/lescout/Plans/PRD-v1.md");
    sections.push("  ~/Projects/lescout/Plans/CONTEXT-DISCIPLINE.md");
    return sections.join("\n");
  }

  const h = COMMANDS[cmd];
  if (!h) {
    return `no help for "${cmd}". try: lescout help`;
  }

  sections.push(`lescout ${cmd} — ${h.synopsis}`);
  sections.push("");
  sections.push("USAGE");
  h.usage.forEach((u) => sections.push(`  ${u}`));
  sections.push("");
  sections.push("DESCRIPTION");
  h.description.split("\n").forEach((l) => sections.push(`  ${l}`));
  sections.push("");
  if (h.flags?.length) {
    sections.push("FLAGS");
    h.flags.forEach((f) => sections.push(`  ${f.flag.padEnd(22)} ${f.desc}`));
    sections.push("");
  }
  if (h.examples?.length) {
    sections.push("EXAMPLES");
    h.examples.forEach((e) => {
      sections.push(`  $ ${e.cmd}`);
      sections.push(`    ${e.what}`);
    });
    sections.push("");
  }
  if (h.exitCodes?.length) {
    sections.push("EXIT CODES");
    h.exitCodes.forEach((c) => sections.push(`  ${String(c.code).padEnd(3)} ${c.meaning}`));
    sections.push("");
  }
  if (h.seeAlso?.length) {
    sections.push("SEE ALSO");
    h.seeAlso.forEach((s) => sections.push(`  ${s}`));
  }
  return sections.join("\n");
}
