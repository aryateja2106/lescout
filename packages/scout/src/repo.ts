// repo.ts — orchestrate the end-to-end scout-a-repo flow.

import { validateRepoUrl } from "./security.ts";
import { runSandbox } from "./sandbox.ts";
import { extractFromSandbox } from "./extract.ts";
import { renderRepoPage, repoSlug, writeToBrain } from "./brain.ts";

export interface ScoutRepoOptions {
  /** Skip writing to the brain (just produce artifacts). */
  dryRun?: boolean;
  /** Override the sandbox image. */
  image?: string;
  /** Container timeout, seconds. */
  timeoutSec?: number;
}

export interface ScoutRepoReport {
  url: string;
  slug: string;
  runId: string;
  outDir: string;
  durationMs: number;
  fileCount: number;
  brainWrite: { ok: boolean; stdout?: string; stderr?: string };
}

export async function scoutRepo(rawUrl: string, opts: ScoutRepoOptions = {}): Promise<ScoutRepoReport> {
  // 1. Validate the URL before docker even sees it.
  const url = validateRepoUrl(rawUrl);
  const slug = repoSlug(url);

  // 2. Run the sandboxed clone + inspection.
  const result = await runSandbox({
    image: opts.image,
    args: [url.toString()],
    timeoutSec: opts.timeoutSec ?? 120,
  });

  if (result.exitCode !== 0) {
    throw new Error(`sandbox exited ${result.exitCode}\n--- stderr ---\n${result.stderr}\n--- stdout ---\n${result.stdout}`);
  }

  // 3. Parse the on-disk artifacts.
  const extraction = await extractFromSandbox(result.outDir, url.toString());

  // 4. Render the brain page.
  const markdown = renderRepoPage(extraction);
  await Bun.write(`${result.outDir}/page.md`, markdown);

  // 5. Hand to brain (unless dry-run).
  let brainWrite: ScoutRepoReport["brainWrite"] = { ok: false };
  if (!opts.dryRun) {
    try {
      const r = await writeToBrain(slug, markdown);
      brainWrite = { ok: true, stdout: r.stdout, stderr: r.stderr };
    } catch (err) {
      brainWrite = { ok: false, stderr: (err as Error).message };
    }
  } else {
    brainWrite = { ok: true, stdout: "(dry-run, brain write skipped)" };
  }

  return {
    url: url.toString(),
    slug,
    runId: result.runId,
    outDir: result.outDir,
    durationMs: result.durationMs,
    fileCount: extraction.fileCount,
    brainWrite,
  };
}
