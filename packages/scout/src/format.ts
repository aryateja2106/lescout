// format.ts — terminal output helpers: ANSI color (TTY-aware, NO_COLOR-aware),
// width detection, smart word-boundary truncation.

const USE_COLOR = process.stdout.isTTY === true && !process.env.NO_COLOR;

const ansi = (code: string, s: string): string =>
  USE_COLOR ? `\x1b[${code}m${s}\x1b[0m` : s;

export const dim = (s: string): string => ansi("2", s);
export const bold = (s: string): string => ansi("1", s);
export const gray = (s: string): string => ansi("90", s);
export const orange = (s: string): string => ansi("38;5;208", s);
export const yellow = (s: string): string => ansi("33", s);
export const magenta = (s: string): string => ansi("35", s);
export const green = (s: string): string => ansi("32", s);
export const cyan = (s: string): string => ansi("36", s);
export const blue = (s: string): string => ansi("34", s);

/** Agent-specific accent color (visual at-a-glance distinction). */
export function agentColor(agent: string): (s: string) => string {
  switch (agent) {
    case "claude":
      return orange;
    case "pi":
      return magenta;
    case "codex":
      return green;
    case "cursor":
      return cyan;
    case "gemini":
      return blue;
    default:
      return (s: string) => s;
  }
}

/** Terminal width, with a sane fallback for non-TTY contexts (pipes, scripts). */
export function termWidth(): number {
  return process.stdout.columns ?? 100;
}

/**
 * Truncate a string at a word boundary if possible, with a trailing ellipsis.
 * Falls back to hard truncation if no acceptable word boundary exists.
 */
export function smartTruncate(s: string, max: number): string {
  if (max <= 1) return "…";
  if (s.length <= max) return s;
  const slice = s.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(" ");
  // Only honor a word boundary if it's at least 60% through the available width.
  const cut = lastSpace > Math.floor(max * 0.6) ? lastSpace : max - 1;
  return s.slice(0, cut).trimEnd() + "…";
}

/** Strip ANSI escape sequences (for measuring "real" printed width). */
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Visible length, ignoring ANSI escape codes. */
export function visibleLength(s: string): number {
  return stripAnsi(s).length;
}
