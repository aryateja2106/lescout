# Research Synthesis — Rowboat / Graphify / GBrain

*2026-05-15. Inputs: GitHub READMEs + ARCHITECTURE docs + docker-compose + on-machine `gbrain list` probe.*

## TL;DR — what we copy, what we ignore

| Source | Copy this | Ignore this |
|--------|-----------|-------------|
| **Graphify** (MIT, pure Python) | Pipeline architecture: `detect → extract → build → cluster → analyze → report → export`. Dict-based, no shared state. Schema (nodes+edges with EXTRACTED/INFERRED/AMBIGUOUS confidence). `security.py` URL allowlist + file:// block + size cap. `watch.py` continuous re-ingestion. `serve.py` MCP stdio. | Python stack (we want Bun). Single-shot `/graphify .` model — we want continuous brain. |
| **Rowboat** (Apache-2.0, TS+Python) | Docker-compose multi-service deployment topology. Vault structure (`Today.md`, entity folders). Always-on cron-driven sync. Slash-command UX (`@rowboat`). | MongoDB + Qdrant + Redis + Auth0 maximalism. Firecrawl dependency (we replace with SearXNG). Desktop electron app (we want CLI-first). |
| **GBrain** (MIT, Bun/TS, on-machine) | Tool surface (already battle-tested: `put`, `get`, `query`, `search`, `import`, `sync`, `files`, `integrations`). PGLite local-first. Self-wiring graph from typed entities. Brain has 20+ Lockshell-related pages already — proven on Arya's data. | Heavy enrichment skills (34 skills) — most are domain-specific to Garry Tan's workflow (X/Calendar/Gmail). Supabase as primary remote engine. |

## The critical patterns to bake into LeScout v1

### 1. Graphify-style pipeline (from `ARCHITECTURE.md`)

```
detect()  →  extract()  →  build_graph()  →  cluster()  →  analyze()  →  report()  →  export()
```

Each stage is a single pure function in its own module. They communicate
through plain dicts — no shared state. This is the architecture we adopt
for `lescout repo` and `lescout grok`. Easy to test, easy to swap stages,
easy to add a new extractor (just add a function + register).

### 2. Graphify-style schema

```json
{
  "nodes": [{"id": "...", "label": "...", "source_file": "...", "source_location": "L42"}],
  "edges": [{"source": "id_a", "target": "id_b", "relation": "calls|imports|uses", "confidence": "EXTRACTED|INFERRED|AMBIGUOUS"}]
}
```

`EXTRACTED` vs `INFERRED` vs `AMBIGUOUS` is the part most graph tools miss.
LeScout's brain stores edge confidence so when an agent says "Sarah works
at Acme", we know whether that came from an explicit email signature
(EXTRACTED) or a co-occurrence guess (INFERRED). Massive trust win.

### 3. Graphify-style `security.py`

```python
validate_url(url)           # http/https only, no file://
_NoFileRedirectHandler      # block file:// redirects mid-fetch
safe_fetch(url)             # size cap + timeout
sanitize_label(label)       # strip control chars, cap 256, HTML-escape
```

We port this exactly to `packages/scout-core/src/security.ts`. The
sandbox container is the second line of defense; security.ts is the first.

### 4. Rowboat-style `Today.md` aggregator

`lescout today` returns the freshest signal across the brain — recent
ingests, open TODOs from scouted repos, queries Arya ran in the last
24h. This becomes the agents' "what's hot" entry point on every session.

### 5. Rowboat-style continuous sync

Pi-5 daemon runs `lescout sync` on a cron — re-scouts known repos for
new commits, re-fetches subscribed RSS, re-pulls connected docs. Brain
compounds without manual prompts.

### 6. GBrain-style tool surface for MCP

LeScout's MCP exposes the same minimal verbs gbrain proved out:
`put`, `get`, `query`, `search`, `list`, `related`, plus our adds:
`scout-repo`, `scout-url`, `scout-search`, `today`, `log`.

## What I am NOT recommending

- **Don't fork rowboat.** Too heavy (MongoDB, Qdrant, Redis, Auth0, electron). We'd own a beast we don't want to maintain.
- **Don't fork graphify.** It's Python; Arya's stack is Bun. We re-implement the patterns in TS.
- **Don't fork gbrain initially.** Use it as the brain for Phases 0–4. Build LeScout brain in Phase 5 only after we know exactly what we need. By then we can decide: replace, sync-with, or stay-on-gbrain.

## What we add that none of them have

1. **Hard-sandboxed ingestion.** Graphify validates URLs but still runs Python on the host. Rowboat shells out to Firecrawl (cloud). GBrain imports markdown that's already on disk. None of them solve "agent encounters untrusted repo, wants to know what's in it, must not execute anything." That's LeScout's unique safety contract.

2. **Pi-5 always-on brain server with remote MCP.** Rowboat is desktop-only. GBrain can use Supabase but is built around single-machine PGLite. LeScout is designed multi-machine from day one.

3. **Hackathon mode.** `lescout init <event>` creates a per-event brain scope, ingests their tool docs/repos in one batch, dies after the event. None of the references have this.

## Concrete LeScout pipeline (synthesized)

```
lescout repo <git-url>
  │
  ▼
detect()         # is it a git URL? a local path? a tarball?
  │
  ▼
sandbox_clone() # docker run, network egress allowlist, --read-only mount
  │
  ▼
extract()        # parallel:
                 #   tree -L 3 -J
                 #   manifests (package.json, pyproject.toml, Cargo.toml, go.mod)
                 #   READMEs (README, AGENTS, CLAUDE, CONTRIBUTING)
                 #   ts-morph / tree-sitter for code symbols (later)
  │
  ▼
build_graph()    # nodes: Repo, File, Module, Manifest, Person(authors)
                 # edges: contains, imports, mentions
  │
  ▼
analyze()        # god files, entrypoints, suggested questions
  │
  ▼
report()         # GRAPH_REPORT.md per repo (LLM-friendly)
  │
  ▼
export()         # write to brain (gbrain put or lescout brain put)
                 # write run audit to ~/.lescout/runs/<id>/
```

## Open implementation questions for Arya

1. **Code-graph depth in Phase 1?** Just tree+manifests+READMEs (fast, ships today), or also tree-sitter symbol extraction for top-N languages (slower, much richer)? I lean Phase 1 = tree+manifests only; tree-sitter in Phase 1.5.
2. **Brain file format?** Plain Markdown (rowboat/gbrain pattern, Obsidian-readable) or pure JSON (faster queries, less human-friendly)? Markdown is the answer if we want Arya to browse the vault by hand.
3. **Sandbox image distribution?** Build locally per-machine, or publish to GHCR (`ghcr.io/aryateja2106/lescout-sandbox:latest`)? GHCR makes Pi-5 deploy trivial.

## File outputs

- `research/rowboat-readme.md` — raw README
- `research/graphify-readme.md` — raw README
- `research/graphify-architecture.md` — full architecture doc
- `research/SYNTHESIS.md` — this file

Next: Arya installs rowboat (manual download), confirms answers above, then Phase 0 begins (GBrain MCP wired and dogfooded — already partially done).
