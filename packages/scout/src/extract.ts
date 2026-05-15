// extract.ts — parse the sandbox's output artifacts into a typed shape.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface ScoutRepoExtraction {
  url: string;
  sha: string;
  scoutedAt: string;
  fileCount: number;
  dirCount: number;
  sizeBytes: number;
  lastCommit: { isoDate: string; author: string; email: string; subject: string } | null;
  tree: unknown; // raw `tree -J` output for now; typed later
  manifests: Record<string, string>; // filename -> contents
  docs: Record<string, string>; // filename -> contents
  todos: Array<{ path: string; line: number; text: string }>;
}

export async function extractFromSandbox(outDir: string, url: string): Promise<ScoutRepoExtraction> {
  const files = await readdir(outDir);

  const meta = await tryRead(outDir, "meta.txt");
  const metaMap = parseKv(meta ?? "");

  const lastCommitRaw = await tryRead(outDir, "lastcommit.txt");
  const lastCommit = lastCommitRaw ? parseLastCommit(lastCommitRaw) : null;

  const sha = (await tryRead(outDir, "sha.txt"))?.trim() ?? "";
  const treeRaw = await tryRead(outDir, "tree.json");
  const tree = treeRaw ? safeJsonParse(treeRaw) : null;

  const manifests: Record<string, string> = {};
  const docs: Record<string, string> = {};
  for (const f of files) {
    if (f.startsWith("manifest.")) {
      const name = f.slice("manifest.".length);
      manifests[name] = (await readFile(join(outDir, f), "utf8")).slice(0, 100_000);
    } else if (f.startsWith("doc.")) {
      const name = f.slice("doc.".length).replace(/_/g, "/");
      docs[name] = (await readFile(join(outDir, f), "utf8")).slice(0, 200_000);
    }
  }

  const todosRaw = await tryRead(outDir, "todos.jsonl");
  const todos = todosRaw ? parseRipgrepJsonl(todosRaw) : [];

  return {
    url,
    sha,
    scoutedAt: metaMap.scouted_at ?? new Date().toISOString(),
    fileCount: Number(metaMap.file_count ?? 0),
    dirCount: Number(metaMap.dir_count ?? 0),
    sizeBytes: Number(metaMap.size_bytes ?? 0),
    lastCommit,
    tree,
    manifests,
    docs,
    todos,
  };
}

async function tryRead(dir: string, name: string): Promise<string | null> {
  try {
    return await readFile(join(dir, name), "utf8");
  } catch {
    return null;
  }
}

function parseKv(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of s.split("\n")) {
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (m) out[m[1]!.trim()] = m[2]!.trim();
  }
  return out;
}

function parseLastCommit(raw: string) {
  const [isoDate = "", author = "", email = "", subject = ""] = raw.split("\n");
  return { isoDate, author, email, subject };
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function parseRipgrepJsonl(raw: string): Array<{ path: string; line: number; text: string }> {
  const out: Array<{ path: string; line: number; text: string }> = [];
  for (const ln of raw.split("\n")) {
    if (!ln) continue;
    try {
      const obj = JSON.parse(ln);
      if (obj?.type === "match" && obj?.data) {
        out.push({
          path: obj.data.path?.text ?? "",
          line: obj.data.line_number ?? 0,
          text: (obj.data.lines?.text ?? "").trim().slice(0, 300),
        });
      }
    } catch {
      /* ignore malformed lines */
    }
  }
  return out.slice(0, 500);
}

/** Produce a compact tree summary (string) for the brain markdown page. */
export function summarizeTree(tree: unknown, maxLines = 80): string {
  if (!Array.isArray(tree) || tree.length === 0) return "(no tree)";
  const root = tree[0];
  if (!root || typeof root !== "object") return "(no tree)";
  const lines: string[] = [];
  walk(root as TreeNode, "", lines, maxLines);
  return lines.slice(0, maxLines).join("\n");
}

interface TreeNode {
  type?: string;
  name?: string;
  contents?: TreeNode[];
}

function walk(n: TreeNode, indent: string, out: string[], cap: number) {
  if (out.length >= cap) return;
  if (n.name) {
    out.push(`${indent}${n.type === "directory" ? "📂" : "📄"} ${n.name}`);
  }
  if (Array.isArray(n.contents)) {
    for (const c of n.contents) {
      walk(c, indent + "  ", out, cap);
    }
  }
}
