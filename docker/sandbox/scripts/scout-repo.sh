#!/bin/sh
# scout-repo.sh — clone a git repo and emit structured artifacts.
# Runs entirely inside the LeScout sandbox container. No host access.
# Foreign hooks, postinstall scripts, build commands are NEVER executed.

set -eu

URL="${1:?usage: scout-repo.sh <git-url>}"
DEST=/work/repo
OUT=/out

mkdir -p "$OUT"

# Hardened clone: shallow, no tags, no submodules, no hooks, no credentials.
git -c core.hooksPath=/dev/null \
    -c credential.helper= \
    -c protocol.allow=never \
    -c protocol.https.allow=always \
    -c protocol.http.allow=always \
    clone \
      --depth 1 \
      --no-tags \
      --no-recurse-submodules \
      --single-branch \
      "$URL" "$DEST"

# Disarm anything executable in the cloned tree (defense in depth — we never
# exec these, but if something later does, it won't have +x).
find "$DEST" -type f -exec chmod -x {} +

# Filetree (depth 3 by default, JSON, ignoring common build dirs).
tree -L 3 -J -a \
  -I '.git|node_modules|dist|build|out|target|.next|.venv|__pycache__|.cache|coverage|.turbo|.parcel-cache' \
  "$DEST" > "$OUT/tree.json"

# Manifest files (copy verbatim).
for f in package.json pyproject.toml Cargo.toml go.mod requirements.txt setup.py setup.cfg \
         composer.json Gemfile build.gradle pom.xml bun.lock pnpm-lock.yaml yarn.lock \
         Cargo.lock poetry.lock deno.json deno.jsonc; do
  if [ -f "$DEST/$f" ]; then
    cp "$DEST/$f" "$OUT/manifest.$f"
  fi
done

# Documentation / agent files.
for f in README.md README readme.md README.rst README.txt \
         AGENTS.md CLAUDE.md GEMINI.md OPENCODE.md \
         CONTRIBUTING.md LICENSE SECURITY.md ARCHITECTURE.md \
         CHANGELOG.md ROADMAP.md docs/README.md; do
  if [ -f "$DEST/$f" ]; then
    name=$(echo "$f" | tr '/' '_')
    cp "$DEST/$f" "$OUT/doc.$name"
  fi
done

# TODO/FIXME scan (text only, ripgrep JSON, capped at ~500 hits).
rg --json --max-count 500 -e 'TODO|FIXME|XXX|HACK' "$DEST" > "$OUT/todos.jsonl" 2>/dev/null || true

# Meta.
git -C "$DEST" rev-parse HEAD > "$OUT/sha.txt"
git -C "$DEST" log -1 --format='%aI%n%an%n%ae%n%s' > "$OUT/lastcommit.txt"
{
  echo "url: $URL"
  echo "scouted_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "sha: $(cat "$OUT/sha.txt")"
  echo "file_count: $(find "$DEST" -type f | wc -l | tr -d ' ')"
  echo "dir_count: $(find "$DEST" -type d | wc -l | tr -d ' ')"
  echo "size_bytes: $(du -sb "$DEST" 2>/dev/null | awk '{print $1}')"
} > "$OUT/meta.txt"

echo "scout-repo: done (sha=$(cat "$OUT/sha.txt" | head -c 8))"
