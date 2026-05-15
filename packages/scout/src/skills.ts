// skills.ts — progressive disclosure for agent skills.
//
// Skills are markdown files (typically SKILL.md) with YAML front matter.
// Loading every body for every agent burns context. The progressive
// disclosure pattern:
//
//   1. listSkills()  → parse only front matter, return cheap index
//   2. loadSkill()   → read full body once the agent decides it needs it
//   3. suggestSkills() → rank by description match for a task
//
// Scan order (later wins for duplicate names):
//   ~/.pi/agent/skills/<slug>/SKILL.md
//   ~/.agents/skills/<slug>/SKILL.md
//   ~/.claude/skills/<slug>/SKILL.md
//   $LESCOUT_SKILL_PATH/*/SKILL.md   (colon-separated extra roots)

import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, basename, dirname, resolve } from "node:path";

const HOME = homedir();

/** Default scan roots, in priority order (later entries override earlier). */
const DEFAULT_ROOTS: Array<{ root: string; scope: SkillScope }> = [
  { root: join(HOME, ".pi", "agent", "skills"), scope: "pi" },
  { root: join(HOME, ".agents", "skills"), scope: "shared" },
  { root: join(HOME, ".claude", "skills"), scope: "claude" },
];

export type SkillScope = "pi" | "shared" | "claude" | "extra";

export interface SkillMeta {
  /** Slug used in CLI and brain slugs. Derived from front-matter `name` (preferred) or directory name. */
  name: string;
  /** One-line (or short paragraph) summary from front matter. */
  description: string;
  /** Absolute path to the SKILL.md file. */
  path: string;
  /** Origin classification (where on disk it lives). */
  scope: SkillScope;
  /** SemVer from front matter `metadata.version`, if present. */
  version: string | null;
  /** Owner string from front matter `metadata.owner`, if present. */
  owner: string | null;
  /** Tools whitelisted in the skill. Empty array if `allowed-tools: <blank>`. */
  allowedTools: string[];
  /** License (`MIT`, etc.) if declared. */
  license: string | null;
  /** Body byte size — useful for cost estimation. */
  bodySize: number;
  /** Approx token cost to load the body (~4 chars/token). */
  bodyTokensApprox: number;
  /** Any other front-matter keys we didn't model explicitly. */
  extra: Record<string, unknown>;
}

export interface SkillDetail extends SkillMeta {
  /** Body markdown after the closing `---`. Trimmed. */
  body: string;
}

export interface ListOptions {
  scope?: SkillScope;
  /** Restrict to skills whose name or description matches this substring. */
  grep?: string;
  /** Extra roots beyond the defaults. */
  extraRoots?: string[];
}

/** Walk every configured root, parse only the front matter, return an index. */
export async function listSkills(opts: ListOptions = {}): Promise<SkillMeta[]> {
  const roots = await collectRoots(opts.extraRoots);
  const bySlug = new Map<string, SkillMeta>();
  for (const r of roots) {
    if (opts.scope && r.scope !== opts.scope) continue;
    const entries = await readdir(r.root).catch(() => []);
    for (const slug of entries) {
      const skillPath = join(r.root, slug, "SKILL.md");
      const lower = join(r.root, slug, "skill.md");
      const tryPath = (await stat(skillPath).catch(() => null)) ? skillPath : (await stat(lower).catch(() => null)) ? lower : null;
      if (!tryPath) continue;
      const meta = await parseFrontMatter(tryPath, r.scope, slug);
      if (!meta) continue;
      // Later root wins on duplicate names (intentional).
      bySlug.set(meta.name, meta);
    }
  }
  let out = [...bySlug.values()];
  if (opts.grep) {
    const q = opts.grep.toLowerCase();
    out = out.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
  }
  out.sort((a, b) => a.scope.localeCompare(b.scope) || a.name.localeCompare(b.name));
  return out;
}

/** Load the full body of a skill by name (or partial-prefix match). */
export async function loadSkill(nameOrPrefix: string, opts: ListOptions = {}): Promise<SkillDetail | null> {
  const all = await listSkills(opts);
  const exact = all.find((s) => s.name === nameOrPrefix);
  if (exact) return enrichWithBody(exact);
  const matches = all.filter((s) => s.name.startsWith(nameOrPrefix));
  if (matches.length === 1) return enrichWithBody(matches[0]!);
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous skill prefix "${nameOrPrefix}" matches: ${matches.map((m) => m.name).join(", ")}`,
    );
  }
  return null;
}

/** Score skills by a task description; returns top-K. */
export async function suggestSkills(task: string, limit = 5, opts: ListOptions = {}): Promise<Array<SkillMeta & { score: number }>> {
  const all = await listSkills(opts);
  const tokens = tokenize(task);
  const scored = all.map((s) => {
    const haystack = `${s.name} ${s.description}`.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (!t) continue;
      if (haystack.includes(t)) score += 1;
      // Bonus for an exact name match.
      if (s.name.toLowerCase() === t) score += 5;
    }
    return { ...s, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.filter((s) => s.score > 0).slice(0, limit);
}

// ──────────────────────────── internal helpers ────────────────────────────

async function collectRoots(extras: string[] = []): Promise<Array<{ root: string; scope: SkillScope }>> {
  const out: Array<{ root: string; scope: SkillScope }> = [];
  for (const r of DEFAULT_ROOTS) {
    if (await stat(r.root).catch(() => null)) out.push(r);
  }
  const envExtra = (process.env.LESCOUT_SKILL_PATH ?? "").split(":").filter(Boolean);
  for (const p of [...envExtra, ...extras]) {
    const abs = resolve(p);
    if (await stat(abs).catch(() => null)) out.push({ root: abs, scope: "extra" });
  }
  return out;
}

async function parseFrontMatter(path: string, scope: SkillScope, slug: string): Promise<SkillMeta | null> {
  const raw = await readFile(path, "utf8").catch(() => null);
  if (!raw) return null;

  const fm = extractFrontMatterText(raw);
  if (!fm) {
    // No front matter — still surface it as a meta-only entry.
    return {
      name: slug,
      description: "(no front matter)",
      path,
      scope,
      version: null,
      owner: null,
      allowedTools: [],
      license: null,
      bodySize: raw.length,
      bodyTokensApprox: Math.round(raw.length / 4),
      extra: {},
    };
  }

  const parsed = parseSimpleYaml(fm.text);

  const name = String(parsed.name ?? slug).trim();
  const description = collapseDescription(parsed.description);
  const metadata = (parsed.metadata ?? {}) as Record<string, unknown>;
  const version = stringOrNull(metadata.version);
  const owner = stringOrNull(metadata.owner);
  const license = stringOrNull(parsed.license);

  let allowedTools: string[] = [];
  const at = parsed["allowed-tools"];
  if (typeof at === "string") allowedTools = at.split(/\s+/).filter(Boolean);
  else if (Array.isArray(at)) allowedTools = at.map(String);

  const bodyText = raw.slice(fm.endIndex);
  return {
    name,
    description,
    path,
    scope,
    version,
    owner,
    allowedTools,
    license,
    bodySize: bodyText.length,
    bodyTokensApprox: Math.round(bodyText.length / 4),
    extra: Object.fromEntries(
      Object.entries(parsed).filter(([k]) => !["name", "description", "metadata", "license", "allowed-tools"].includes(k)),
    ),
  };
}

async function enrichWithBody(meta: SkillMeta): Promise<SkillDetail> {
  const raw = await readFile(meta.path, "utf8");
  const fm = extractFrontMatterText(raw);
  const body = (fm ? raw.slice(fm.endIndex) : raw).trim();
  return { ...meta, body };
}

function extractFrontMatterText(s: string): { text: string; endIndex: number } | null {
  if (!s.startsWith("---")) return null;
  const close = s.indexOf("\n---", 4);
  if (close < 0) return null;
  const text = s.slice(4, close).trim();
  // endIndex points after the closing "\n---\n"
  const after = s.indexOf("\n", close + 4);
  return { text, endIndex: after >= 0 ? after + 1 : close + 4 };
}

/**
 * Tiny YAML reader for the subset our skills actually use:
 *   key: value
 *   key: |
 *     multi-line
 *   key:
 *     nested: value
 *   key:
 *     - item
 * Handles trailing comments, quoted strings, and one level of nesting.
 * If a skill uses something exotic, the `extra` map still surfaces it.
 */
function parseSimpleYaml(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim() || line.trim().startsWith("#")) {
      i++;
      continue;
    }
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1]!;
    const rawVal = m[2]!.trim();

    if (rawVal === "|" || rawVal === ">") {
      // Block scalar; consume indented lines.
      const buf: string[] = [];
      i++;
      while (i < lines.length && /^\s+/.test(lines[i]!)) {
        buf.push(lines[i]!.replace(/^\s{2}/, ""));
        i++;
      }
      out[key] = rawVal === "|" ? buf.join("\n") : buf.join(" ");
      continue;
    }

    if (rawVal === "") {
      // Inline-empty or nested. Look ahead.
      const nested: Record<string, unknown> = {};
      const arr: string[] = [];
      i++;
      while (i < lines.length && /^\s+/.test(lines[i]!)) {
        const childLine = lines[i]!;
        const dash = /^\s+-\s+(.*)$/.exec(childLine);
        const kv = /^\s+([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(childLine);
        if (dash) {
          arr.push(stripQuotes(dash[1]!));
        } else if (kv) {
          nested[kv[1]!] = stripQuotes(kv[2]!);
        }
        i++;
      }
      if (arr.length > 0) out[key] = arr;
      else if (Object.keys(nested).length > 0) out[key] = nested;
      else out[key] = "";
      continue;
    }

    out[key] = stripQuotes(rawVal);
    i++;
  }
  return out;
}

function stripQuotes(s: string): string {
  const t = s.trim().replace(/\s+#.*$/, "");
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function stringOrNull(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return null;
}

function collapseDescription(v: unknown): string {
  if (v == null) return "";
  const s = typeof v === "string" ? v : String(v);
  return s.replace(/\s+/g, " ").trim();
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\-_\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

/** Render the lightweight skill index as markdown suitable for `gbrain put`. */
export function renderSkillIndex(skills: SkillMeta[]): string {
  const head = [
    "---",
    `title: Skill index (progressive disclosure)`,
    `type: skill-index`,
    `assembled_at: ${new Date().toISOString()}`,
    `count: ${skills.length}`,
    `tags: [skills, lescout, progressive-disclosure]`,
    "---",
    "",
    "# Skill index",
    "",
    "> Cheap front-matter-only catalog. Agents can scan this once, then call",
    "> `lescout skills load <name>` to fetch only the bodies they actually need.",
    "",
    "| scope | name | size | description |",
    "|-------|------|------|-------------|",
  ];
  const rows = skills.map(
    (s) =>
      `| ${s.scope} | \`${s.name}\` | ${(s.bodySize / 1024).toFixed(1)} KB / ~${s.bodyTokensApprox}t | ${escapePipes(s.description.slice(0, 200))} |`,
  );
  return [...head, ...rows, ""].join("\n");
}

function escapePipes(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
