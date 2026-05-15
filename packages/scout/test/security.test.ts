import { describe, expect, test } from "bun:test";
import { validateRepoUrl, parseRepoIdentity, sanitizeLabel, SecurityError } from "../src/security.ts";

describe("validateRepoUrl", () => {
  test("accepts github.com https URL", () => {
    const u = validateRepoUrl("https://github.com/safishamsi/graphify");
    expect(u.hostname).toBe("github.com");
  });

  test("accepts gitlab.com", () => {
    expect(() => validateRepoUrl("https://gitlab.com/owner/repo")).not.toThrow();
  });

  test("rejects non-allowlisted host", () => {
    expect(() => validateRepoUrl("https://evil.example.com/owner/repo")).toThrow(SecurityError);
  });

  test("rejects file:// protocol", () => {
    expect(() => validateRepoUrl("file:///etc/passwd")).toThrow(SecurityError);
  });

  test("rejects ftp:// protocol", () => {
    expect(() => validateRepoUrl("ftp://github.com/x/y")).toThrow(SecurityError);
  });

  test("rejects embedded credentials", () => {
    expect(() => validateRepoUrl("https://user:pass@github.com/x/y")).toThrow(SecurityError);
  });

  test("rejects empty input", () => {
    expect(() => validateRepoUrl("")).toThrow(SecurityError);
  });

  test("rejects oversized URL", () => {
    expect(() => validateRepoUrl("https://github.com/" + "a".repeat(3000))).toThrow(SecurityError);
  });

  test("rejects malformed URL", () => {
    expect(() => validateRepoUrl("not a url")).toThrow(SecurityError);
  });

  test("rejects control chars", () => {
    expect(() => validateRepoUrl("https://github.com/x\x00/y")).toThrow(SecurityError);
  });
});

describe("parseRepoIdentity", () => {
  test("extracts owner+name from github URL", () => {
    const u = new URL("https://github.com/safishamsi/graphify");
    const id = parseRepoIdentity(u);
    expect(id.owner).toBe("safishamsi");
    expect(id.name).toBe("graphify");
    expect(id.host).toBe("github.com");
  });

  test("strips .git suffix", () => {
    const u = new URL("https://github.com/foo/bar.git");
    expect(parseRepoIdentity(u).name).toBe("bar");
  });
});

describe("sanitizeLabel", () => {
  test("strips control chars", () => {
    expect(sanitizeLabel("hello\x00world")).toBe("helloworld");
  });

  test("caps at maxLen", () => {
    const s = sanitizeLabel("a".repeat(500), 100);
    expect(s.length).toBeLessThanOrEqual(101); // 100 + ellipsis
    expect(s.endsWith("…")).toBe(true);
  });

  test("preserves newlines and tabs", () => {
    expect(sanitizeLabel("hi\nthere\t!")).toBe("hi\nthere\t!");
  });
});
