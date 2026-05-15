// skills.test.ts — verify the progressive-disclosure primitives.
import { expect, test, describe } from "bun:test";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { listSkills, loadSkill, suggestSkills, renderSkillIndex } from "../src/skills.ts";

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), "lescout-skills-test-"));
  await mkdir(join(root, "build-verify"), { recursive: true });
  await mkdir(join(root, "no-frontmatter"), { recursive: true });
  await mkdir(join(root, "complex"), { recursive: true });

  await writeFile(
    join(root, "build-verify", "SKILL.md"),
    `---
name: build-verify
description: Detect project type and run the correct build + lint commands.
license: MIT
metadata:
  version: 0.1.0
  owner: tommy
allowed-tools: bash read
---

# Body
This is the body of build-verify.
`,
  );

  await writeFile(
    join(root, "no-frontmatter", "SKILL.md"),
    `# Just markdown\n\nNo front matter at all.\n`,
  );

  await writeFile(
    join(root, "complex", "SKILL.md"),
    `---
name: complex
description: |
  Multi-line description that spans
  several lines for readability.
metadata:
  version: 1.2.3
  owner: lesearch
allowed-tools:
  - bash
  - read
  - edit
license: Apache-2.0
---

# Complex body
With more content.
`,
  );

  return root;
}

describe("listSkills", () => {
  test("parses standard front matter", async () => {
    const root = await makeFixture();
    process.env.LESCOUT_SKILL_PATH = root;

    const skills = await listSkills({ scope: "extra" });
    const bv = skills.find((s) => s.name === "build-verify");

    expect(bv).toBeDefined();
    expect(bv!.description).toBe("Detect project type and run the correct build + lint commands.");
    expect(bv!.license).toBe("MIT");
    expect(bv!.version).toBe("0.1.0");
    expect(bv!.owner).toBe("tommy");
    expect(bv!.allowedTools).toEqual(["bash", "read"]);
    expect(bv!.bodyTokensApprox).toBeGreaterThan(0);

    delete process.env.LESCOUT_SKILL_PATH;
  });

  test("handles multi-line descriptions and array allowed-tools", async () => {
    const root = await makeFixture();
    process.env.LESCOUT_SKILL_PATH = root;

    const skills = await listSkills({ scope: "extra" });
    const complex = skills.find((s) => s.name === "complex");

    expect(complex).toBeDefined();
    expect(complex!.description).toContain("Multi-line description");
    expect(complex!.allowedTools).toEqual(["bash", "read", "edit"]);
    expect(complex!.version).toBe("1.2.3");
    expect(complex!.license).toBe("Apache-2.0");

    delete process.env.LESCOUT_SKILL_PATH;
  });

  test("surfaces skills without front matter (graceful fallback)", async () => {
    const root = await makeFixture();
    process.env.LESCOUT_SKILL_PATH = root;

    const skills = await listSkills({ scope: "extra", grep: "no-frontmatter" });
    expect(skills.length).toBeGreaterThan(0);
    expect(skills[0]!.description).toBe("(no front matter)");

    delete process.env.LESCOUT_SKILL_PATH;
  });

  test("respects grep filter", async () => {
    const root = await makeFixture();
    process.env.LESCOUT_SKILL_PATH = root;

    const onlyBuild = await listSkills({ scope: "extra", grep: "build" });
    expect(onlyBuild.find((s) => s.name === "build-verify")).toBeDefined();
    expect(onlyBuild.find((s) => s.name === "complex")).toBeUndefined();

    delete process.env.LESCOUT_SKILL_PATH;
  });
});

describe("loadSkill", () => {
  test("returns full body and trims whitespace", async () => {
    const root = await makeFixture();
    process.env.LESCOUT_SKILL_PATH = root;

    const d = await loadSkill("build-verify", { scope: "extra" });
    expect(d).not.toBeNull();
    expect(d!.body).toContain("This is the body of build-verify");
    expect(d!.body.endsWith(".")).toBeTrue();

    delete process.env.LESCOUT_SKILL_PATH;
  });

  test("returns null for unknown skill", async () => {
    const root = await makeFixture();
    process.env.LESCOUT_SKILL_PATH = root;

    const d = await loadSkill("nope", { scope: "extra" });
    expect(d).toBeNull();

    delete process.env.LESCOUT_SKILL_PATH;
  });

  test("resolves a unique prefix", async () => {
    const root = await makeFixture();
    process.env.LESCOUT_SKILL_PATH = root;

    const d = await loadSkill("compl", { scope: "extra" });
    expect(d?.name).toBe("complex");

    delete process.env.LESCOUT_SKILL_PATH;
  });
});

describe("suggestSkills", () => {
  test("ranks by description-token overlap", async () => {
    const root = await makeFixture();
    process.env.LESCOUT_SKILL_PATH = root;

    const top = await suggestSkills("detect project type and run build", 3, { scope: "extra" });
    expect(top.length).toBeGreaterThan(0);
    expect(top[0]!.name).toBe("build-verify");
    expect(top[0]!.score).toBeGreaterThan(0);

    delete process.env.LESCOUT_SKILL_PATH;
  });

  test("returns empty when no tokens match", async () => {
    const root = await makeFixture();
    process.env.LESCOUT_SKILL_PATH = root;

    const top = await suggestSkills("xyzqrstuvwxyzqrstuv", 5, { scope: "extra" });
    expect(top).toEqual([]);

    delete process.env.LESCOUT_SKILL_PATH;
  });
});

describe("renderSkillIndex", () => {
  test("produces a brain-ready markdown index", async () => {
    const root = await makeFixture();
    process.env.LESCOUT_SKILL_PATH = root;

    const skills = await listSkills({ scope: "extra" });
    const md = renderSkillIndex(skills);

    expect(md).toContain("type: skill-index");
    expect(md).toContain("| scope | name | size | description |");
    expect(md).toContain("`build-verify`");
    expect(md).toContain("`complex`");

    delete process.env.LESCOUT_SKILL_PATH;
  });
});
