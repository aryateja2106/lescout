// store.ts — unified artifact registry (read MVP).
//
// LeStore covers five artifact types across every coding agent on a host:
//   - skill      (SKILL.md with YAML front matter)        — fully supported
//   - mcp        (MCP server entries in agent configs)    — supported
//   - hook       (lifecycle scripts)                      — partial
//   - plugin     (agent-specific bundles)                 — partial
//   - extension  (TypeScript/Bun modules)                 — supported (pi extensions)
//
// This module only READS what's already on disk and normalises it into a
// common shape. Install/remove/sync land in Phase 2 once the manifest
// schema is approved.

import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import { listSkills, type SkillMeta } from "./skills.ts";

const HOME = homedir();

export type ArtifactType = "skill" | "mcp" | "hook" | "plugin" | "extension";

export interface ArtifactMeta {
  type: ArtifactType;
  id: string;
  /** Where on disk the artifact lives (file or dir). */
  path: string;
  /** Origin classification — "claude" | "pi" | "shared" | "bob" | "codex" | "cursor" | "gemini" | "extra". */
  scope: string;
  description: string;
  version: string | null;
  /** Rough token cost to load the whole artifact, when meaningful. */
  bodyTokensApprox: number;
  /** Per-type extras (allowed-tools, command, args, env, …). */
  extras: Record<string, unknown>;
}

export interface ListOptions {
  type?: ArtifactType;
  agent?: string;
  grep?: string;
}

/**
 * Walk every known discovery root for every artifact type and return a
 * normalised list. Order: skill > mcp > extension > hook > plugin.
 */
export async function listArtifacts(opts: ListOptions = {}): Promise<ArtifactMeta[]> {
  const out: ArtifactMeta[] = [];

  if (!opts.type || opts.type === "skill") {
    const skills = await listSkills();
    for (const s of skills) out.push(skillToArtifact(s));
  }

  if (!opts.type || opts.type === "mcp") {
    out.push(...(await listMcps()));
  }

  if (!opts.type || opts.type === "extension") {
    out.push(...(await listExtensions()));
  }

  if (!opts.type || opts.type === "hook") {
    out.push(...(await listHooks()));
  }

  if (!opts.type || opts.type === "plugin") {
    // Plugins are agent-specific; we surface the agent's plugin dirs only.
    out.push(...(await listPlugins()));
  }

  let filtered = out;
  if (opts.agent) {
    filtered = filtered.filter((a) => a.scope === opts.agent);
  }
  if (opts.grep) {
    const q = opts.grep.toLowerCase();
    filtered = filtered.filter(
      (a) => a.id.toLowerCase().includes(q) || a.description.toLowerCase().includes(q),
    );
  }
  filtered.sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id));
  return filtered;
}

/** Token-overlap ranking across every artifact type. */
export async function searchArtifacts(query: string, limit = 8, opts: ListOptions = {}): Promise<Array<ArtifactMeta & { score: number }>> {
  const all = await listArtifacts(opts);
  const tokens = query
    .toLowerCase()
    .replace(/[^a-z0-9\-_\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);

  const scored = all.map((a) => {
    const haystack = `${a.id} ${a.description}`.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (haystack.includes(t)) score += 1;
      if (a.id.toLowerCase() === t) score += 5;
    }
    return { ...a, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.filter((s) => s.score > 0).slice(0, limit);
}

/** Discovery roots we walk — exposed for the `lescout store roots` command. */
export interface DiscoveryRoot {
  type: ArtifactType;
  scope: string;
  path: string;
  exists: boolean;
}

export async function listRoots(): Promise<DiscoveryRoot[]> {
  const roots: Omit<DiscoveryRoot, "exists">[] = [
    { type: "skill", scope: "pi", path: join(HOME, ".pi", "agent", "skills") },
    { type: "skill", scope: "shared", path: join(HOME, ".agents", "skills") },
    { type: "skill", scope: "claude", path: join(HOME, ".claude", "skills") },
    { type: "mcp", scope: "claude", path: join(HOME, ".claude.json") },
    { type: "mcp", scope: "cursor", path: join(HOME, ".cursor", "mcp.json") },
    { type: "mcp", scope: "codex", path: join(HOME, ".codex", "config.toml") },
    { type: "mcp", scope: "bob", path: join(HOME, ".bob", "settings.json") },
    { type: "extension", scope: "pi", path: join(HOME, ".pi", "agent", "extensions") },
    { type: "hook", scope: "claude", path: join(HOME, ".claude", "hooks") },
    { type: "plugin", scope: "claude", path: join(HOME, ".claude", "plugins") },
  ];
  const out: DiscoveryRoot[] = [];
  for (const r of roots) {
    const exists = !!(await stat(r.path).catch(() => null));
    out.push({ ...r, exists });
  }
  return out;
}

// ─────────────────────────── per-type loaders ───────────────────────────

function skillToArtifact(s: SkillMeta): ArtifactMeta {
  return {
    type: "skill",
    id: s.name,
    path: s.path,
    scope: s.scope,
    description: s.description,
    version: s.version,
    bodyTokensApprox: s.bodyTokensApprox,
    extras: {
      allowedTools: s.allowedTools,
      license: s.license,
      owner: s.owner,
    },
  };
}

/**
 * MCP discovery — read each agent's config (best-effort, won't crash on
 * weird shapes). The config schemas are not standardised so we tolerate
 * missing keys.
 */
async function listMcps(): Promise<ArtifactMeta[]> {
  const out: ArtifactMeta[] = [];

  // Claude Code: ~/.claude.json (current schema uses { mcpServers: { name: { command, args, env } } })
  const claudeCfg = await readJsonSafe(join(HOME, ".claude.json"));
  if (claudeCfg) {
    const servers =
      (claudeCfg as Record<string, unknown>).mcpServers ??
      (claudeCfg as Record<string, unknown>)["mcp_servers"];
    if (servers && typeof servers === "object") {
      for (const [id, def] of Object.entries(servers as Record<string, unknown>)) {
        out.push(mcpFromDef("claude", id, def));
      }
    }
  }

  // Cursor: ~/.cursor/mcp.json (same shape as Claude)
  const cursorCfg = await readJsonSafe(join(HOME, ".cursor", "mcp.json"));
  if (cursorCfg) {
    const servers = (cursorCfg as Record<string, unknown>).mcpServers;
    if (servers && typeof servers === "object") {
      for (const [id, def] of Object.entries(servers as Record<string, unknown>)) {
        out.push(mcpFromDef("cursor", id, def));
      }
    }
  }

  // Bob: ~/.bob/settings.json has its own MCP layout; we surface it best-effort.
  const bobCfg = await readJsonSafe(join(HOME, ".bob", "settings.json"));
  if (bobCfg) {
    const servers =
      (bobCfg as Record<string, unknown>).mcpServers ??
      (bobCfg as Record<string, unknown>).mcp ??
      null;
    if (servers && typeof servers === "object") {
      for (const [id, def] of Object.entries(servers as Record<string, unknown>)) {
        out.push(mcpFromDef("bob", id, def));
      }
    }
  }

  return out;
}

function mcpFromDef(scope: string, id: string, def: unknown): ArtifactMeta {
  const d = (def as Record<string, unknown>) ?? {};
  const command = String(d.command ?? "");
  const args = Array.isArray(d.args) ? (d.args as unknown[]).map(String) : [];
  return {
    type: "mcp",
    id,
    path: command || `(${scope} config)`,
    scope,
    description: command ? `${command} ${args.join(" ")}` : `(${scope} mcp ${id})`,
    version: null,
    bodyTokensApprox: 0,
    extras: { command, args, env: d.env ?? {} },
  };
}

async function listExtensions(): Promise<ArtifactMeta[]> {
  const out: ArtifactMeta[] = [];
  const piExt = join(HOME, ".pi", "agent", "extensions");
  for (const name of await readdir(piExt).catch(() => [])) {
    const dir = join(piExt, name);
    const st = await stat(dir).catch(() => null);
    if (!st || !st.isDirectory()) continue;
    // Look for an entry file: index.ts, index.js, manifest.json.
    let entry = "";
    for (const candidate of ["index.ts", "index.js", "manifest.json", "package.json"]) {
      const p = join(dir, candidate);
      if (await stat(p).catch(() => null)) {
        entry = p;
        break;
      }
    }
    let description = "(pi extension)";
    const pkg = await readJsonSafe(join(dir, "package.json"));
    if (pkg && typeof (pkg as Record<string, unknown>).description === "string") {
      description = String((pkg as Record<string, unknown>).description);
    }
    out.push({
      type: "extension",
      id: name,
      path: entry || dir,
      scope: "pi",
      description,
      version: pkg ? String((pkg as Record<string, unknown>).version ?? "") || null : null,
      bodyTokensApprox: 0,
      extras: { entry },
    });
  }
  return out;
}

async function listHooks(): Promise<ArtifactMeta[]> {
  const out: ArtifactMeta[] = [];
  // Claude Code hooks live as discrete files in ~/.claude/hooks/<lifecycle>/<name>
  const claudeHooks = join(HOME, ".claude", "hooks");
  const phases = await readdir(claudeHooks).catch(() => []);
  for (const phase of phases) {
    const phaseDir = join(claudeHooks, phase);
    const st = await stat(phaseDir).catch(() => null);
    if (!st || !st.isDirectory()) continue;
    for (const f of await readdir(phaseDir).catch(() => [])) {
      const filePath = join(phaseDir, f);
      const fst = await stat(filePath).catch(() => null);
      if (!fst || !fst.isFile()) continue;
      out.push({
        type: "hook",
        id: `${phase}/${f}`,
        path: filePath,
        scope: "claude",
        description: `${phase} hook (${(fst.size / 1024).toFixed(1)} KB)`,
        version: null,
        bodyTokensApprox: Math.round(fst.size / 4),
        extras: { phase },
      });
    }
  }
  return out;
}

async function listPlugins(): Promise<ArtifactMeta[]> {
  const out: ArtifactMeta[] = [];
  // Claude Code plugins live under ~/.claude/plugins/<name>.
  const claudePlugins = join(HOME, ".claude", "plugins");
  for (const name of await readdir(claudePlugins).catch(() => [])) {
    const dir = join(claudePlugins, name);
    const st = await stat(dir).catch(() => null);
    if (!st || !st.isDirectory()) continue;
    const manifest = await readJsonSafe(join(dir, "plugin.json"));
    const description =
      (manifest && typeof (manifest as Record<string, unknown>).description === "string"
        ? String((manifest as Record<string, unknown>).description)
        : "(claude plugin)");
    out.push({
      type: "plugin",
      id: name,
      path: dir,
      scope: "claude",
      description,
      version:
        manifest && typeof (manifest as Record<string, unknown>).version === "string"
          ? String((manifest as Record<string, unknown>).version)
          : null,
      bodyTokensApprox: 0,
      extras: {},
    });
  }
  return out;
}

async function readJsonSafe(path: string): Promise<unknown> {
  try {
    const text = await readFile(path, "utf8");
    return JSON.parse(text);
  } catch {
    return null;
  }
}
