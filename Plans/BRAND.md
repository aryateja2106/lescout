# LeSearch AI — Brand & Product Family

**Tagline:** *Less Search, More Agents.*
**Parent:** LeSearch AI (Arya Teja's company / brand)
**License:** MIT across the family
**Status:** locked 2026-05-15

## Product family

| Product | What it does | Status | Slug prefix in brain |
|---------|--------------|--------|----------------------|
| **LeSearch AI** | Parent company / iOS app on TestFlight (App ID 6759892293) | Live | `lesearch/*` |
| **LeScout** *(this repo)* | Sandboxed ingestion: repos, URLs, docs, sessions. Foreign code never touches host. | Phase 1.7 | `scout/*` |
| **LeBrain** *(planned)* | Unified brain layer over GBrain + future agentmemory. One MCP, three DB scopes (global/project/local), Pi-5 always-on server. | Phase 4 | `brain/*` |
| **LeMem** *(planned)* | Per-session context discipline: 100K budget enforcement, caveman-compress, auto-checkpoint hooks. | Phase 3 | `mem/*` |
| **LeLoop** *(planned)* | Personal Software Factory: idea → autonomous prototype → Ralph loop overnight → product. | Phase 6 | `loop/*` |

## Naming rules

- **Le** prefix, single capitalized following word (LeScout, LeBrain, LeMem, LeLoop).
- Lowercase CLI: `lescout`, `lebrain`, `lemem`, `leloop`. One word, no hyphen.
- Sub-commands are verbs: `lescout repo`, `lescout context`, `lemem compact`, `leloop run`.
- Versions follow semver: `0.0.4`, `0.1.0`. Daily-build tags follow `vYYYY.MM.DD-<short-sha>` (e.g. `v2026.05.15-923afa4`).

## Personal Software Factory (the thesis)

LeSearch AI is not a chat product. It is a **personal software factory** —
infrastructure that lets one founder + a fleet of agents build, ship, and
maintain multiple companies simultaneously.

```
   IDEAS                  PROTOTYPES             PRODUCTS
   ─────                  ──────────             ────────

   Arya stores ideas      LeLoop picks an idea   When a prototype proves
   in his brain via       autonomously, gathers  itself, LeLoop kicks off
   LeMem / LeBrain.       context via LeScout,   a Ralph loop overnight
                          builds a prototype.    with feedback + tests +
   Inbox, journals,       Arya watches what      traceability to harden it.
   X-saves, paper notes,  works and what
   conversations.         doesn't. He gives
                          reference repos to
                          improve it.
```

### Why "Less Search, More Agents" matters

Every developer today spends 30-60% of their day SEARCHING — Stack Overflow,
docs, old chats, their own old code, X, blogs, GitHub. LeSearch flips it:
**search once, agents act forever.** The brain compounds; ingest is
deterministic; retrieval is hybrid; agents run the loops.

## Open Usage tracking

LeSearch AI's daily ops surface usage from every agent harness via the
Open Usage CLI:

```
openusage status   # claude / codex / cursor / gemini consumption
openusage daily    # daily roll-up across all four
openusage forecast # rate-limit prediction for the rest of the week
```

LeLoop reads this to pace overnight builds (don't burn the weekly Opus
budget on cosmetic refactors).

## North Star ladder

```
Personal Brain     →  one founder, one machine            (TODAY)
Founder Brain      →  one founder, many machines          (Pi-5 + Tailscale)
Company Brain      →  Tom Blomfield RFS — multi-tenant    (FUTURE)
```

Same engine, different access controls and entity catalogs. LeScout's
sandbox + LeBrain's storage + LeMem's discipline + LeLoop's execution
ladder up cleanly.

## Distribution

- **PRIMARY** — npm: `bun install -g @lesearchai/scout` (publish target: Phase 2)
- **SECONDARY** — Docker MCP Catalog: `aryateja2106/lescout-mcp:0.x.y` (Phase 3)
- **PORTABLE** — pre-built single-binary via `bun build --compile` (Phase 2)
