// redact.ts — scrub secrets out of values we are about to print or persist.
//
// LeScout's job is "show agents what they need to know without leaking
// secrets". This module is the central place for that discipline. Patterns
// here mirror Plans/CONTEXT-DISCIPLINE.md.
//
// Usage:
//   - `redactSecretValue(v)` — returns "<REDACTED>" if `v` looks like a
//     secret (literal token, API key, bearer header).
//   - `redactEnv(env)` — redact every value in an env map. We default to
//     paranoid: ANY env-variable value in an MCP/config context is treated
//     as sensitive because (a) it almost always *is*, and (b) the user can
//     still see the *key names*, which is what they need to debug.

/**
 * Known secret-shaped tokens. These match common provider key prefixes plus
 * generic bearer / private-key markers. Add patterns as we encounter them;
 * false positives are cheap (we just over-redact) and the alternative is
 * leaking real keys via `lescout store info <mcp>`.
 */
const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/, // OpenAI, Anthropic-style
  /\bsk-ant-[A-Za-z0-9_-]{16,}\b/, // Anthropic explicit
  /\bghp_[A-Za-z0-9]{20,}\b/, // GitHub personal access token
  /\bgho_[A-Za-z0-9]{20,}\b/, // GitHub OAuth token
  /\bghs_[A-Za-z0-9]{20,}\b/, // GitHub server-to-server token
  /\bghu_[A-Za-z0-9]{20,}\b/, // GitHub user-to-server token
  /\bAIza[0-9A-Za-z_-]{20,}\b/, // Google API key
  /\bxoxb-[0-9A-Za-z-]{20,}\b/, // Slack bot token
  /\bxoxp-[0-9A-Za-z-]{20,}\b/, // Slack user token
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/i, // Authorization headers
  /-----BEGIN (RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/i,
  /\bbob_prod_[A-Za-z0-9_-]{20,}\b/, // IBM Bob enterprise tokens
];

/**
 * Return "<REDACTED>" if the value looks like a known secret, otherwise the
 * value untouched. Operates on `unknown` so call sites don't have to
 * narrow-type first.
 */
export function redactSecretValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  for (const pat of SECRET_PATTERNS) {
    if (pat.test(s)) return "<REDACTED>";
  }
  return s;
}

/**
 * Redact every value in an env-style map. Keys are preserved (the user
 * needs them to debug) but values are fully replaced with "<REDACTED>"
 * regardless of pattern — env vars in MCP/agent configs are sensitive by
 * default. Use `redactSecretValue` directly if you need per-value heuristic
 * redaction instead of blanket redaction.
 */
export function redactEnv(env: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === null || v === undefined || v === "") {
      out[k] = "";
    } else {
      out[k] = "<REDACTED>";
    }
  }
  return out;
}

/**
 * Scrub secret-shaped substrings in a free-text body. Used before writing
 * to the brain or to a context bundle file.
 */
export function redactText(s: string): string {
  let out = s;
  for (const pat of SECRET_PATTERNS) {
    out = out.replace(new RegExp(pat.source, pat.flags.includes("g") ? pat.flags : pat.flags + "g"), "<REDACTED>");
  }
  return out;
}
