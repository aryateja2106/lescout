import { describe, expect, test } from "bun:test";
import { redactSecretValue, redactEnv, redactText } from "../src/redact.ts";

describe("redactSecretValue", () => {
  test("redacts OpenAI / Anthropic sk- tokens", () => {
    expect(redactSecretValue("sk-proj-abc1234567890123456789")).toBe("<REDACTED>");
    expect(redactSecretValue("sk-ant-aBcDeFgHiJkLmNoP123456")).toBe("<REDACTED>");
  });

  test("redacts GitHub tokens of all four prefixes", () => {
    expect(redactSecretValue("ghp_aGitHubTokenLooksLikeThis20")).toBe("<REDACTED>");
    expect(redactSecretValue("gho_aGitHubTokenLooksLikeThis20")).toBe("<REDACTED>");
    expect(redactSecretValue("ghs_aGitHubTokenLooksLikeThis20")).toBe("<REDACTED>");
    expect(redactSecretValue("ghu_aGitHubTokenLooksLikeThis20")).toBe("<REDACTED>");
  });

  test("redacts IBM Bob enterprise tokens", () => {
    // Truncated synthetic, not a real key
    expect(redactSecretValue("bob_prod_bob-user_E4ByjXX8wd9h7t9wkz6fL")).toBe("<REDACTED>");
  });

  test("redacts Google AIza, Slack xoxb/xoxp, Bearer headers", () => {
    expect(redactSecretValue("AIzaSyC_synthetic_KlA73YfEaNBXHpX5eTo")).toBe("<REDACTED>");
    expect(redactSecretValue("xoxb-12345-67890-abcdefghijklmno")).toBe("<REDACTED>");
    expect(redactSecretValue("Bearer eyJhbGciOiJIUzI1NiIs9876543210")).toBe("<REDACTED>");
  });

  test("redacts PEM private-key markers", () => {
    expect(redactSecretValue("-----BEGIN RSA PRIVATE KEY-----")).toBe("<REDACTED>");
    expect(redactSecretValue("-----BEGIN OPENSSH PRIVATE KEY-----")).toBe("<REDACTED>");
  });

  test("passes plain values through unchanged", () => {
    expect(redactSecretValue("just_a_value")).toBe("just_a_value");
    expect(redactSecretValue("/usr/local/bin/foo")).toBe("/usr/local/bin/foo");
    expect(redactSecretValue("")).toBe("");
  });
});

describe("redactEnv (blanket-redact, keys preserved)", () => {
  test("redacts every non-empty value regardless of shape", () => {
    const out = redactEnv({
      OPENAI_API_KEY: "sk-real-key-here-1234567890",
      WORKSPACE: "dev",
      MISC: "anything",
    });
    expect(out.OPENAI_API_KEY).toBe("<REDACTED>");
    expect(out.WORKSPACE).toBe("<REDACTED>");
    expect(out.MISC).toBe("<REDACTED>");
  });

  test("preserves empty strings as empty (not redacted)", () => {
    expect(redactEnv({ EMPTY: "" }).EMPTY).toBe("");
  });

  test("preserves all key names", () => {
    const env = { OPENAI_API_KEY: "sk-x", ANTHROPIC_API_KEY: "sk-y", FOO: "bar" };
    const keys = Object.keys(redactEnv(env));
    expect(keys.sort()).toEqual(["ANTHROPIC_API_KEY", "FOO", "OPENAI_API_KEY"]);
  });
});

describe("redactText (free-form substring scrub)", () => {
  test("replaces secret-shaped substrings inside larger text", () => {
    const out = redactText("token=sk-proj-1234567890abcdefghij plus ghp_token1234567890123456abcdef");
    expect(out).toContain("<REDACTED>");
    expect(out).not.toContain("sk-proj-");
    expect(out).not.toContain("ghp_token");
  });

  test("leaves non-secret content alone", () => {
    expect(redactText("Hello world, no secrets here")).toBe("Hello world, no secrets here");
  });
});
