# LeScout

> Less Scout, More Context.

A two-half personal knowledge stack — sandboxed scouting + always-on
hybrid-search brain — that follows you across machines (Mac, Linux,
Raspberry Pi 5 server) and feeds every agent harness you use (pi,
Claude Code, Cursor, Codex, Gemini, Amp).

**Status:** v0 design phase. PRD + research live in `Plans/` and `research/`.

## Why

- Foreign code never touches the host. Sandbox container only.
- One brain, every agent, every machine.
- No vendor lock-in. SearXNG instead of Exa/Firecrawl. SQLite/PGLite local.
- Pi-5 is the always-on brain server. Mac/VPS connect via remote MCP over Tailscale.

## Reading order

1. `Plans/PRD-v1.md` — full vision and phases.
2. `research/SYNTHESIS.md` — what we steal from rowboat / graphify / gbrain.
3. (coming) `docs/architecture.md` — implementation specifics.

## License

MIT (planned, on first public commit).
