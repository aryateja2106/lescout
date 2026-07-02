// session.test.ts — verify session support and native resume command helpers.
import { describe, expect, test } from "bun:test";

import {
  sessionDisplayId,
  sessionListItem,
  sessionResumeCommand,
  sessionSupport,
  type Agent,
  type SessionMeta,
} from "../src/session.ts";

function meta(agent: Agent, parserSupport: SessionMeta["parserSupport"] = "full"): SessionMeta {
  return {
    agent,
    chatId: `${agent}-session-123`,
    shortId: `${agent}-se`.slice(0, 8),
    displayId: undefined,
    jsonlPath: `/tmp/${agent}.jsonl`,
    projectDir: "Users_aryateja_Project",
    cwd: "/Users/aryateja/Project",
    title: `${agent} session`,
    startedAt: "2026-05-20T00:00:00.000Z",
    endedAt: "2026-05-20T00:10:00.000Z",
    lineCount: 12,
    sizeBytes: 1024,
    parserSupport,
    usage: null,
  };
}

describe("sessionResumeCommand", () => {
  test("prints trusted native resume commands for full parser-supported agents", () => {
    expect(sessionResumeCommand(meta("claude"))).toBe("claude --resume claude-session-123");
    expect(sessionResumeCommand(meta("pi"))).toBe("pi --resume pi-session-123");
    expect(sessionResumeCommand(meta("codex"))).toBe("codex resume codex-session-123");
  });

  test("does not claim native resume support for metadata-only or unsupported agents", () => {
    expect(sessionResumeCommand(meta("cursor", "meta-only"))).toBeNull();
    expect(sessionResumeCommand(meta("gemini", "meta-only"))).toBeNull();
    expect(sessionResumeCommand(meta("bob"))).toBeNull();
  });
});

describe("sessionSupport", () => {
  test("marks full Claude/Pi/Codex sessions as context plus native resume", () => {
    expect(sessionSupport(meta("claude"))).toEqual(["context", "native-resume"]);
    expect(sessionSupport(meta("pi"))).toEqual(["context", "native-resume"]);
    expect(sessionSupport(meta("codex"))).toEqual(["context", "native-resume"]);
  });

  test("marks metadata-only sessions honestly", () => {
    expect(sessionSupport(meta("cursor", "meta-only"))).toEqual(["meta-only"]);
    expect(sessionSupport(meta("gemini", "meta-only"))).toEqual(["meta-only"]);
  });
});

describe("sessionListItem", () => {
  test("adds machine-readable support, resume command, and context slug", () => {
    const item = sessionListItem(meta("codex"));

    expect(item.support).toEqual(["context", "native-resume"]);
    expect(item.resumeCommand).toBe("codex resume codex-session-123");
    expect(item.contextSlug).toBe("sessions/codex_users_aryateja_project/2026-05-20-codex-se");
  });

  test("does not generate a context slug for metadata-only sessions", () => {
    const item = sessionListItem(meta("cursor", "meta-only"));

    expect(item.support).toEqual(["meta-only"]);
    expect(item.resumeCommand).toBeNull();
    expect(item.contextSlug).toBeNull();
  });
});

describe("sessionDisplayId", () => {
  test("uses UUID tail to avoid UUIDv7 prefix collisions", () => {
    expect(
      sessionDisplayId({
        chatId: "019e5059-c5ae-78b3-985c-86b0dc2f0d25",
        shortId: "019e5059",
      }),
    ).toBe("86b0dc2f");
  });

  test("falls back to shortId for non-UUID session ids", () => {
    expect(sessionDisplayId({ chatId: "claude-session-123", shortId: "claude-s" })).toBe("claude-s");
  });
});
