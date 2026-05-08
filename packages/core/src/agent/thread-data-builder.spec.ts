import { describe, expect, it } from "vitest";
import {
  buildAssistantMessage,
  mergeThreadDataForClientSave,
  upsertAssistantMessage,
} from "./thread-data-builder.js";
import type { RunEvent } from "./types.js";

describe("buildAssistantMessage", () => {
  it("does not persist partial output from internal continuation boundaries", () => {
    const events: RunEvent[] = [
      { seq: 0, event: { type: "text", text: "partial answer" } },
      { seq: 1, event: { type: "auto_continue", reason: "run_timeout" } },
    ];

    expect(
      buildAssistantMessage(events, "run-timeout", {
        suppressInternalContinuation: true,
      }),
    ).toBeNull();
  });

  it("does not persist partial output from suppressed loop-limit boundaries", () => {
    const events: RunEvent[] = [
      { seq: 0, event: { type: "text", text: "partial answer" } },
      { seq: 1, event: { type: "loop_limit", maxIterations: 50 } },
    ];

    expect(
      buildAssistantMessage(events, "run-loop-limit", {
        suppressInternalContinuation: true,
      }),
    ).toBeNull();
  });

  it("does not persist partial output from recoverable gateway errors when suppressed", () => {
    const events: RunEvent[] = [
      { seq: 0, event: { type: "text", text: "checking..." } },
      {
        seq: 1,
        event: {
          type: "error",
          error: "Builder gateway timed out after 45s",
          errorCode: "builder_gateway_timeout",
        },
      },
    ];

    expect(
      buildAssistantMessage(events, "run-gateway-timeout", {
        suppressInternalContinuation: true,
      }),
    ).toBeNull();
  });

  it("does not persist partial output from bare gateway stop errors when suppressed", () => {
    const events: RunEvent[] = [
      { seq: 0, event: { type: "text", text: "checking..." } },
      {
        seq: 1,
        event: {
          type: "error",
          error:
            'Gateway error (no detail; raw event: {"type":"stop","reason":"error","requestId":"req_1"})',
          errorCode: "builder_gateway_error",
        },
      },
    ];

    expect(
      buildAssistantMessage(events, "run-gateway-error", {
        suppressInternalContinuation: true,
      }),
    ).toBeNull();
  });

  it("persists recoverable errors by default for non-continuation server paths", () => {
    const events: RunEvent[] = [
      { seq: 0, event: { type: "text", text: "checking..." } },
      {
        seq: 1,
        event: {
          type: "error",
          error: "Builder gateway timed out after 45s",
          errorCode: "builder_gateway_timeout",
        },
      },
    ];

    const message = buildAssistantMessage(events, "run-gateway-timeout");

    expect(message?.content).toEqual([
      {
        type: "text",
        text: "checking...\n\nError: Builder gateway timed out after 45s",
      },
    ]);
    expect(message?.status).toEqual({ type: "incomplete", reason: "error" });
  });

  it("still persists non-recoverable errors", () => {
    const events: RunEvent[] = [
      { seq: 0, event: { type: "text", text: "checking..." } },
      {
        seq: 1,
        event: {
          type: "error",
          error: "Missing API key",
          errorCode: "missing_api_key",
        },
      },
    ];

    const message = buildAssistantMessage(events, "run-missing-key");

    expect(message?.content).toEqual([
      { type: "text", text: "checking...\n\nError: Missing API key" },
    ]);
    expect(message?.status).toEqual({ type: "incomplete", reason: "error" });
  });

  it("replaces a non-terminal partial assistant message for the same run", () => {
    const finalMessage = buildAssistantMessage(
      [
        { seq: 0, event: { type: "text", text: "I can see there are " } },
        { seq: 1, event: { type: "text", text: "12 matching emails." } },
        { seq: 2, event: { type: "done" } },
      ],
      "run-archive",
    );
    expect(finalMessage).not.toBeNull();

    const repo = {
      messages: [
        {
          message: {
            id: "user-1",
            role: "user",
            content: [{ type: "text", text: "archive them" }],
          },
          parentId: null,
        },
        {
          message: {
            id: "assistant-partial",
            role: "assistant",
            content: [{ type: "text", text: "I can see there are " }],
            status: { type: "running" },
            metadata: { custom: { runId: "run-archive" } },
          },
          parentId: "user-1",
        },
      ],
    };

    const updated = upsertAssistantMessage(repo, finalMessage!);

    expect(updated.messages).toHaveLength(2);
    expect(updated.messages[1].parentId).toBe("user-1");
    expect(updated.messages[1].message).toMatchObject({
      id: "server-run-archive",
      role: "assistant",
      content: [
        { type: "text", text: "I can see there are 12 matching emails." },
      ],
      status: { type: "complete", reason: "stop" },
      metadata: { runId: "run-archive" },
    });
  });

  it("does not duplicate when the frontend already saved the final same-run message", () => {
    const finalMessage = buildAssistantMessage(
      [
        { seq: 0, event: { type: "text", text: "Done." } },
        { seq: 1, event: { type: "done" } },
      ],
      "run-done",
    );
    expect(finalMessage).not.toBeNull();

    const repo = {
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "do it" }],
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "Done." }],
          status: { type: "complete", reason: "stop" },
          metadata: { custom: { runId: "run-done" } },
        },
      ],
    };

    const updated = upsertAssistantMessage(repo, finalMessage!);

    expect(updated.messages).toHaveLength(2);
    expect(updated.messages[1]).toMatchObject({
      id: "server-run-done",
      role: "assistant",
      content: [{ type: "text", text: "Done." }],
      status: { type: "complete", reason: "stop" },
      metadata: { runId: "run-done" },
    });
  });

  it("appends when the last assistant belongs to a different completed run", () => {
    const finalMessage = buildAssistantMessage(
      [
        { seq: 0, event: { type: "text", text: "New answer." } },
        { seq: 1, event: { type: "done" } },
      ],
      "run-new",
    );
    expect(finalMessage).not.toBeNull();

    const repo = {
      messages: [
        {
          role: "assistant",
          content: [{ type: "text", text: "Old answer." }],
          status: { type: "complete", reason: "stop" },
          metadata: { runId: "run-old" },
        },
      ],
    };

    const updated = upsertAssistantMessage(repo, finalMessage!);

    expect(updated.messages).toHaveLength(2);
    expect(updated.messages[1]).toMatchObject({
      id: "server-run-new",
      content: [{ type: "text", text: "New answer." }],
    });
  });

  it("does not replace a completed different-run answer with a prefix-matching recovery answer", () => {
    const finalMessage = buildAssistantMessage(
      [
        {
          seq: 0,
          event: {
            type: "text",
            text: "Let me start a subagent to analyze the data. Finished.",
          },
        },
        { seq: 1, event: { type: "done" } },
      ],
      "run-new",
    );
    expect(finalMessage).not.toBeNull();

    const repo = {
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "Let me start a subagent to analyze the data.",
            },
          ],
          status: { type: "complete", reason: "stop" },
          metadata: { runId: "run-old" },
        },
      ],
    };

    const updated = upsertAssistantMessage(repo, finalMessage!);

    expect(updated.messages).toHaveLength(2);
    expect(updated.messages[0]).toMatchObject({
      metadata: { runId: "run-old" },
    });
    expect(updated.messages[1]).toMatchObject({
      id: "server-run-new",
      content: [
        {
          type: "text",
          text: "Let me start a subagent to analyze the data. Finished.",
        },
      ],
    });
  });
});

describe("mergeThreadDataForClientSave", () => {
  it("preserves server-only assistant messages when a stale client save arrives", () => {
    const existing = {
      queuedMessages: [{ id: "queued", text: "next" }],
      messages: [
        {
          role: "user",
          id: "user-1",
          content: [{ type: "text", text: "start" }],
        },
        {
          role: "assistant",
          id: "server-run-1",
          content: [{ type: "text", text: "server answer" }],
          status: { type: "complete", reason: "stop" },
          metadata: { runId: "run-1" },
        },
      ],
    };
    const staleIncoming = {
      messages: [
        {
          role: "user",
          id: "user-1",
          content: [{ type: "text", text: "start" }],
        },
      ],
    };

    const merged = mergeThreadDataForClientSave(existing, staleIncoming);

    expect(merged.queuedMessages).toEqual([{ id: "queued", text: "next" }]);
    expect(merged.messages).toEqual(existing.messages);
  });

  it("keeps a terminal server message over a stale same-run partial", () => {
    const existing = {
      messages: [
        {
          role: "assistant",
          id: "server-run-1",
          content: [{ type: "text", text: "Final answer" }],
          status: { type: "complete", reason: "stop" },
          metadata: { runId: "run-1" },
        },
      ],
    };
    const staleIncoming = {
      messages: [
        {
          role: "assistant",
          id: "assistant-partial",
          content: [{ type: "text", text: "Final" }],
          status: { type: "running" },
          metadata: { custom: { runId: "run-1" } },
        },
      ],
    };

    const merged = mergeThreadDataForClientSave(existing, staleIncoming);

    expect(merged.messages).toEqual(existing.messages);
  });
});
