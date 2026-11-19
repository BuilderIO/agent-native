/**
 * The submission payload travels beside the body's own fields, and the server refuses a
 * start when they disagree ("submissionPayload does not match this message",
 * packages/core/src/agent/production-agent.ts). These tests pin the one rule that makes
 * that impossible: the payload the client sends is derived from the body.
 */
import { describe, expect, it } from "vitest";

import { submissionPayloadForRequest } from "./runtime.js";

const threadId = "thread-1";

describe("submissionPayloadForRequest", () => {
  it("follows references the body gained after the payload was built", () => {
    // The wrapper case the audit named: a transport wrapper injects context into the
    // request references only. Before this derivation the server answered 400.
    const stored = { id: "message-1", threadId, text: "summarize" };
    const derived = submissionPayloadForRequest(stored, {
      threadId,
      agentKitMessageId: "message-1",
      text: "summarize",
      references: [{ type: "event", id: "evt-9" }],
    }) as Record<string, unknown>;
    expect(derived.references).toEqual([{ type: "event", id: "evt-9" }]);
    expect(derived.text).toBe("summarize");
    expect(derived.id).toBe("message-1");
  });

  it("drops references the body no longer carries, instead of leaving a stale list", () => {
    const stored = {
      id: "message-1",
      threadId,
      text: "summarize",
      references: [{ type: "event", id: "evt-1" }],
    };
    const derived = submissionPayloadForRequest(stored, {
      threadId,
      agentKitMessageId: "message-1",
      text: "summarize",
    }) as Record<string, unknown>;
    expect("references" in derived).toBe(false);
    // The server compares `references ?? []`, so absent and empty are the same fact.
    expect(derived.references ?? []).toEqual([]);
  });

  it("takes the thread id and text from the body, so a rebuilt message cannot disagree", () => {
    const stored = { id: "old-id", threadId: "stale-thread", text: "original" };
    const derived = submissionPayloadForRequest(stored, {
      threadId: "thread-2",
      agentKitMessageId: "message-2",
      text: "edited",
    }) as Record<string, unknown>;
    expect(derived).toMatchObject({
      threadId: "thread-2",
      id: "message-2",
      text: "edited",
    });
  });

  it("keeps options in step with the body and drops them when the body has none", () => {
    const withOptions = submissionPayloadForRequest(
      { id: "message-1", threadId, text: "hi", options: { model: "old" } },
      {
        threadId,
        agentKitMessageId: "message-1",
        text: "hi",
        options: { model: "new" },
      },
    ) as Record<string, unknown>;
    expect(withOptions.options).toEqual({ model: "new" });

    const withoutOptions = submissionPayloadForRequest(
      { id: "message-1", threadId, text: "hi", options: { model: "old" } },
      { threadId, agentKitMessageId: "message-1", text: "hi" },
    ) as Record<string, unknown>;
    expect("options" in withoutOptions).toBe(false);
    expect(withoutOptions.options ?? {}).toEqual({});
  });

  it("leaves the payload's own fields alone", () => {
    const derived = submissionPayloadForRequest(
      {
        id: "message-1",
        threadId,
        text: "hi",
        metadata: { fingerprint: "abc", origin: "composer" },
        model: "gpt-5",
      },
      { threadId, agentKitMessageId: "message-1", text: "hi" },
    ) as Record<string, unknown>;
    expect(derived.metadata).toEqual({
      fingerprint: "abc",
      origin: "composer",
    });
    expect(derived.model).toBe("gpt-5");
  });

  it("passes a non-object payload through untouched", () => {
    expect(
      submissionPayloadForRequest(undefined, { threadId, text: "hi" }),
    ).toBe(undefined);
    expect(
      submissionPayloadForRequest("payload", { threadId, text: "hi" }),
    ).toBe("payload");
    expect(
      submissionPayloadForRequest([1, 2], { threadId, text: "hi" }),
    ).toEqual([1, 2]);
  });
});
