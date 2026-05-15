// sandbox.ts — invoke the LeScout Docker sandbox with hardened flags.
// Every container is ephemeral, rootless, capability-stripped, memory-capped.

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

export interface SandboxRunOptions {
  /** Docker image to run. */
  image?: string;
  /** Arguments passed to the image's entrypoint. */
  args: string[];
  /** Memory limit, e.g. "1g". */
  memory?: string;
  /** CPU limit, e.g. "1.0". */
  cpus?: string;
  /** Run-id (also used as the audit directory name). Generated if omitted. */
  runId?: string;
  /** Override audit dir root. Defaults to $HOME/.lescout/runs. */
  auditRoot?: string;
  /** Container timeout in seconds. Defaults to 120. */
  timeoutSec?: number;
}

export interface SandboxResult {
  runId: string;
  outDir: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  startedAt: string;
  endedAt: string;
  image: string;
  durationMs: number;
}

const DEFAULT_IMAGE = "lescout/sandbox:latest";

export async function runSandbox(opts: SandboxRunOptions): Promise<SandboxResult> {
  const runId = opts.runId ?? randomUUID();
  const auditRoot = opts.auditRoot ?? join(homedir(), ".lescout", "runs");
  const outDir = join(auditRoot, runId);
  await mkdir(outDir, { recursive: true });

  const image = opts.image ?? DEFAULT_IMAGE;
  const dockerArgs = [
    "run",
    "--rm",
    // Hardening flags. Each one matters.
    "--read-only", // host bind mounts are read-only; container fs is read-only
    "--tmpfs", "/work:rw,exec,size=512m,mode=1777", // ephemeral writable scratch
    "--tmpfs", "/tmp:rw,size=64m,mode=1777",
    "--cap-drop", "ALL", // strip every Linux capability
    "--security-opt", "no-new-privileges",
    "--memory", opts.memory ?? "1g",
    "--memory-swap", opts.memory ?? "1g", // disable swap
    "--cpus", opts.cpus ?? "1.0",
    "--pids-limit", "256",
    "--ulimit", "nofile=1024:1024",
    "--network", "bridge", // egress only — allowlist enforcement is Phase 2 (custom net)
    "--user", "1000:1000",
    "-v", `${outDir}:/out:rw`,
    "--env-file", "/dev/null", // hard kill of env inheritance
    image,
    ...opts.args,
  ];

  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const { exitCode, stdout, stderr } = await runDocker(dockerArgs, opts.timeoutSec ?? 120);

  const endedAt = new Date().toISOString();
  const result: SandboxResult = {
    runId,
    outDir,
    exitCode,
    stdout,
    stderr,
    startedAt,
    endedAt,
    image,
    durationMs: Date.now() - t0,
  };

  // Persist the audit envelope alongside the artifacts.
  await Bun.write(
    join(outDir, "_run.json"),
    JSON.stringify({ ...result, args: dockerArgs }, null, 2),
  );

  return result;
}

function runDocker(args: string[], timeoutSec: number): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, timeoutSec * 1000);

    child.stdout.on("data", (d) => stdoutChunks.push(d));
    child.stderr.on("data", (d) => stderrChunks.push(d));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (killed) {
        reject(new Error(`sandbox timed out after ${timeoutSec}s\n${stderr}`));
        return;
      }
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
  });
}
