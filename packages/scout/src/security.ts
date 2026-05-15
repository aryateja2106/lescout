// security.ts — first line of defense before anything reaches the sandbox.
// Port of graphify's security.py philosophy: validate aggressively at the edge.

/** Allowed hostnames for repo cloning. Tight by default; extend with care. */
const REPO_HOST_ALLOWLIST = new Set([
  "github.com",
  "gitlab.com",
  "bitbucket.org",
  "codeberg.org",
  "git.sr.ht",
  "sourcehut.org",
]);

/** Allowed URL protocols. file://, ftp://, gopher:// etc. are denied. */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "git:"]);

export class SecurityError extends Error {
  constructor(public reason: string, public input: string) {
    super(`Security: ${reason} (input: ${input.slice(0, 200)})`);
    this.name = "SecurityError";
  }
}

/**
 * Validate a git URL before passing to the sandbox.
 * Throws SecurityError on anything suspicious.
 */
export function validateRepoUrl(raw: string): URL {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new SecurityError("empty url", raw);
  }
  if (raw.length > 2048) {
    throw new SecurityError("url exceeds 2048 chars", raw);
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SecurityError("malformed url", raw);
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new SecurityError(`protocol not allowed: ${url.protocol}`, raw);
  }

  const host = url.hostname.toLowerCase();
  if (!REPO_HOST_ALLOWLIST.has(host)) {
    throw new SecurityError(`host not in allowlist: ${host}`, raw);
  }

  // Strip embedded credentials (https://user:pass@github.com/...) — we never want
  // to leak Arya's git creds into a sandbox.
  if (url.username || url.password) {
    throw new SecurityError("embedded credentials forbidden", raw);
  }

  // Prevent obvious path-traversal / null-byte attempts.
  if (/[\x00-\x1f]/.test(raw) || url.pathname.includes("..")) {
    throw new SecurityError("control chars or path traversal", raw);
  }

  return url;
}

/** Sanitize a string before it lands in a brain page label or a log line. */
export function sanitizeLabel(input: string, maxLen = 256): string {
  const stripped = input
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "") // strip control chars (keep \t \n \r)
    .replace(/[<>]/g, "") // strip raw angle brackets
    .trim();
  return stripped.length > maxLen ? stripped.slice(0, maxLen) + "…" : stripped;
}

/** Parse a github-style URL into owner + name for slug generation. */
export function parseRepoIdentity(url: URL): { owner: string; name: string; host: string } {
  const parts = url.pathname.replace(/^\/+|\/+$|\.git$/g, "").split("/");
  if (parts.length < 2) {
    throw new SecurityError("expected /owner/name in url", url.toString());
  }
  return { owner: sanitizeLabel(parts[0]!, 64), name: sanitizeLabel(parts[1]!, 96), host: url.hostname };
}
