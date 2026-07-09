import { describe, expect, it } from "vitest";

import {
  buildAssistantMessage,
  buildRepositoryFromCodeAgentTranscript,
  buildUserMessage,
  extractThreadMeta,
  foldAssistantTurn,
  mergeThreadDataForClientSave,
  normalizeThreadRepository,
  upsertAssistantMessage,
  upsertUserMessage,
} from "./thread-data-builder.js";
import type { RunEvent } from "./types.js";

describe("extractThreadMeta", () => {
  it("prefers a manual title override while keeping the message preview", () => {
    const meta = extractThreadMeta({
      _titleOverride: "  Renamed   chat ",
      messages: [
        {
          message: {
            role: "user",
            content: [{ type: "text", text: "what should we ship next?" }],
          },
        },
      ],
    });

    expect(meta).toEqual({
      title: "Renamed chat",
      preview: "what should we ship next?",
    });
  });
});

describe("buildAssistantMessage", () => {
  it("clears rejected draft text while preserving completed tool results", () => {
    const events: RunEvent[] = [
      {
        seq: 0,
        event: {
          type: "tool_start",
          tool: "query",
          input: { sql: "select 1" },
        },
      },
      { seq: 1, event: { type: "tool_done", tool: "query", result: "1" } },
      { seq: 2, event: { type: "text", text: "Rejected draft" } },
      { seq: 3, event: { type: "clear" } },
      { seq: 4, event: { type: "text", text: "Corrected answer" } },
    ];

    const message = buildAssistantMessage(events, "run-clear");

    expect(message?.content).toEqual([
      expect.objectContaining({
        type: "tool-call",
        toolName: "query",
        result: "1",
      }),
      { type: "text", text: "Corrected answer" },
    ]);
  });

  it("rebuilds streamed thinking as persisted reasoning parts", () => {
    const events: RunEvent[] = [
      { seq: 0, event: { type: "thinking", text: "First, " } },
      { seq: 1, event: { type: "thinking", text: "inspect state." } },
      { seq: 2, event: { type: "text", text: "Done." } },
    ];

    const message = buildAssistantMessage(events, "run-thinking");

    expect(message?.content).toEqual([
      { type: "reasoning", text: "First, inspect state." },
      { type: "text", text: "Done." },
    ]);
  });

  it("clears rejected draft reasoning on retry", () => {
    const events: RunEvent[] = [
      { seq: 0, event: { type: "thinking", text: "bad reasoning" } },
      { seq: 1, event: { type: "clear" } },
      { seq: 2, event: { type: "thinking", text: "correct reasoning" } },
      { seq: 3, event: { type: "text", text: "Corrected answer" } },
    ];

    const message = buildAssistantMessage(events, "run-clear-thinking");

    expect(message?.content).toEqual([
      { type: "reasoning", text: "correct reasoning" },
      { type: "text", text: "Corrected answer" },
    ]);
  });

  it("persists partial output from internal continuation boundaries", () => {
    const events: RunEvent[] = [
      { seq: 0, event: { type: "text", text: "partial answer" } },
      { seq: 1, event: { type: "auto_continue", reason: "run_timeout" } },
    ];

    const message = buildAssistantMessage(events, "run-timeout", {
      suppressInternalContinuation: true,
      turnId: "turn-timeout",
    });

    expect(message?.content).toEqual([
      { type: "text", text: "partial answer" },
    ]);
    expect(message?.metadata).toMatchObject({
      runId: "run-timeout",
      custom: {
        turnId: "turn-timeout",
        foldedRunIds: ["run-timeout"],
        continued: true,
      },
    });
  });

  it("persists partial output from suppressed loop-limit boundaries", () => {
    const events: RunEvent[] = [
      { seq: 0, event: { type: "text", text: "partial answer" } },
      { seq: 1, event: { type: "loop_limit", maxIterations: 50 } },
    ];

    const message = buildAssistantMessage(events, "run-loop-limit", {
      suppressInternalContinuation: true,
      turnId: "turn-loop-limit",
    });

    expect(message?.content).toEqual([
      { type: "text", text: "partial answer" },
    ]);
    expect(message?.metadata).toMatchObject({
      custom: {
        turnId: "turn-loop-limit",
        foldedRunIds: ["run-loop-limit"],
        continued: true,
      },
    });
  });

  it("scopes rebuilt tool call ids by run id", () => {
    const message = buildAssistantMessage(
      [
        {
          seq: 0,
          event: { type: "tool_start", tool: "search", input: { q: "logs" } },
        },
        {
          seq: 1,
          event: { type: "tool_done", tool: "search", result: "found" },
        },
      ],
      "run-tools",
      { turnId: "turn-tools" },
    );

    expect(message?.content).toEqual([
      expect.objectContaining({
        type: "tool-call",
        toolCallId: "run-tools:tc_1",
        toolName: "search",
        result: "found",
      }),
    ]);
  });

  it("settles unresolved tool calls on terminal rebuilt messages", () => {
    const message = buildAssistantMessage(
      [
        {
          seq: 0,
          event: {
            type: "tool_start",
            tool: "save-analysis",
            input: { id: "stale-analysis" },
          },
        },
        { seq: 1, event: { type: "done" } },
      ],
      "run-stale-tool",
      { turnId: "turn-stale-tool" },
    );

    expect(message?.content).toEqual([
      expect.objectContaining({
        type: "tool-call",
        toolName: "save-analysis",
        result: "Interrupted before this tool returned a result.",
      }),
    ]);
  });

  it("keeps unresolved tool calls pending at internal continuation boundaries", () => {
    const message = buildAssistantMessage(
      [
        {
          seq: 0,
          event: {
            type: "tool_start",
            tool: "save-analysis",
            input: { id: "continuing-analysis" },
          },
        },
        { seq: 1, event: { type: "auto_continue", reason: "run_timeout" } },
      ],
      "run-continuing-tool",
      { suppressInternalContinuation: true, turnId: "turn-continuing-tool" },
    );

    expect(message?.content).toEqual([
      expect.not.objectContaining({ result: expect.any(String) }),
    ]);
    expect(message?.metadata).toMatchObject({
      custom: { continued: true },
    });
  });

  it("persists partial output from recoverable gateway errors when suppressed", () => {
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

    const message = buildAssistantMessage(events, "run-gateway-timeout", {
      suppressInternalContinuation: true,
      turnId: "turn-gateway-timeout",
    });

    expect(message?.content).toEqual([{ type: "text", text: "checking..." }]);
    expect(message?.metadata).toMatchObject({
      custom: {
        turnId: "turn-gateway-timeout",
        foldedRunIds: ["run-gateway-timeout"],
        continued: true,
      },
    });
  });

  it("persists bare gateway stop errors when continuation errors are suppressed", () => {
    const events: RunEvent[] = [
      { seq: 0, event: { type: "text", text: "checking..." } },
      {
        seq: 1,
        event: {
          type: "error",
          error:
            'Gateway error (no detail; raw event: {"type":"stop","reason":"error","requestId":"req_1"})',
          errorCode: "builder_gateway_error",
          recoverable: true,
        },
      },
    ];

    const message = buildAssistantMessage(events, "run-gateway-error", {
      suppressInternalContinuation: true,
    });

    expect(message?.content).toEqual([
      {
        type: "text",
        text: 'checking...\n\nError: Gateway error (no detail; raw event: {"type":"stop","reason":"error","requestId":"req_1"})',
      },
    ]);
    expect(message?.status).toEqual({ type: "incomplete", reason: "error" });
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
          id: "user-1",
          role: "user",
          content: [{ type: "text", text: "do it" }],
        },
        {
          id: "client-run-done",
          role: "assistant",
          content: [{ type: "text", text: "Done." }],
          status: { type: "complete", reason: "stop" },
          metadata: { custom: { runId: "run-done" } },
        },
      ],
    };

    const updated = upsertAssistantMessage(repo, finalMessage!);

    expect(updated.messages).toHaveLength(2);
    expect(updated.messages[1].message).toMatchObject({
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
          id: "server-run-old",
          role: "assistant",
          content: [{ type: "text", text: "Old answer." }],
          status: { type: "complete", reason: "stop" },
          metadata: { runId: "run-old" },
        },
      ],
    };

    const updated = upsertAssistantMessage(repo, finalMessage!);

    expect(updated.messages).toHaveLength(2);
    expect(updated.messages[1].message).toMatchObject({
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
          id: "server-run-old",
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
    expect(updated.messages[0].message).toMatchObject({
      metadata: { runId: "run-old" },
    });
    expect(updated.messages[1].message).toMatchObject({
      id: "server-run-new",
      content: [
        {
          type: "text",
          text: "Let me start a subagent to analyze the data. Finished.",
        },
      ],
    });
  });

  it("folds continuation chunks for one logical turn into one durable assistant message", () => {
    const firstChunk = buildAssistantMessage(
      [
        { seq: 0, event: { type: "text", text: "First chunk. " } },
        { seq: 1, event: { type: "auto_continue", reason: "run_timeout" } },
      ],
      "run-fold-1",
      { suppressInternalContinuation: true, turnId: "turn-fold" },
    );
    const secondChunk = buildAssistantMessage(
      [
        { seq: 0, event: { type: "text", text: "Second chunk." } },
        { seq: 1, event: { type: "done" } },
      ],
      "run-fold-2",
      { suppressInternalContinuation: true, turnId: "turn-fold" },
    );
    expect(firstChunk).not.toBeNull();
    expect(secondChunk).not.toBeNull();

    let repo = foldAssistantTurn(
      {
        messages: [
          {
            message: {
              id: "user-1",
              role: "user",
              content: [{ type: "text", text: "finish this" }],
            },
            parentId: null,
          },
        ],
      },
      firstChunk!,
      { turnId: "turn-fold", runId: "run-fold-1" },
    );
    repo = foldAssistantTurn(repo, secondChunk!, {
      turnId: "turn-fold",
      runId: "run-fold-2",
    });

    expect(repo.messages).toHaveLength(2);
    expect(repo.messages[1].message.content).toEqual([
      { type: "text", text: "First chunk. Second chunk." },
    ]);
    expect(repo.messages[1].message.metadata).toMatchObject({
      runId: "run-fold-2",
      custom: {
        turnId: "turn-fold",
        foldedRunIds: ["run-fold-1", "run-fold-2"],
      },
    });
    expect(repo.messages[1].message.metadata.custom.continued).toBeUndefined();
  });

  it("keeps tool call ids unique when folding continuation chunks", () => {
    const firstChunk = buildAssistantMessage(
      [
        {
          seq: 0,
          event: { type: "tool_start", tool: "search", input: { q: "one" } },
        },
        {
          seq: 1,
          event: { type: "tool_done", tool: "search", result: "one" },
        },
        { seq: 2, event: { type: "auto_continue", reason: "run_timeout" } },
      ],
      "run-fold-tools-1",
      { suppressInternalContinuation: true, turnId: "turn-fold-tools" },
    );
    const secondChunk = buildAssistantMessage(
      [
        {
          seq: 0,
          event: { type: "tool_start", tool: "search", input: { q: "two" } },
        },
        {
          seq: 1,
          event: { type: "tool_done", tool: "search", result: "two" },
        },
        { seq: 2, event: { type: "done" } },
      ],
      "run-fold-tools-2",
      { suppressInternalContinuation: true, turnId: "turn-fold-tools" },
    );
    expect(firstChunk).not.toBeNull();
    expect(secondChunk).not.toBeNull();

    let repo = foldAssistantTurn({ messages: [] }, firstChunk!, {
      turnId: "turn-fold-tools",
      runId: "run-fold-tools-1",
    });
    repo = foldAssistantTurn(repo, secondChunk!, {
      turnId: "turn-fold-tools",
      runId: "run-fold-tools-2",
    });

    const toolCallIds = repo.messages[0].message.content
      .filter((part: any) => part.type === "tool-call")
      .map((part: any) => part.toolCallId);

    expect(toolCallIds).toEqual([
      "run-fold-tools-1:tc_1",
      "run-fold-tools-2:tc_1",
    ]);
    expect(new Set(toolCallIds).size).toBe(toolCallIds.length);
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
    expect(merged.messages.map((entry: any) => entry.message.id)).toEqual([
      "user-1",
      "server-run-1",
    ]);
    expect(merged.messages[0].parentId).toBeNull();
    expect(merged.messages[1].parentId).toBe("user-1");
  });

  it("drops empty assistant placeholders when the real server answer arrives", () => {
    const existing = {
      messages: [
        {
          message: {
            id: "user-1",
            role: "user",
            content: [{ type: "text", text: "test" }],
          },
          parentId: null,
        },
        {
          message: {
            id: "placeholder",
            role: "assistant",
            content: [],
          },
          parentId: "user-1",
        },
      ],
      headId: "placeholder",
    };
    const incoming = {
      messages: [
        {
          message: {
            id: "user-1",
            role: "user",
            content: [{ type: "text", text: "test" }],
          },
          parentId: null,
        },
        {
          message: {
            id: "server-run-1",
            role: "assistant",
            content: [{ type: "text", text: "Done." }],
            status: { type: "complete", reason: "stop" },
            metadata: { runId: "run-1" },
          },
          parentId: "user-1",
        },
      ],
      headId: "server-run-1",
    };

    const merged = mergeThreadDataForClientSave(existing, incoming);

    expect(merged.messages.map((entry: any) => entry.message.id)).toEqual([
      "user-1",
      "server-run-1",
    ]);
    expect(merged.messages[1].parentId).toBe("user-1");
    expect(merged.headId).toBe("server-run-1");
  });

  it("preserves non-runtime top-level thread metadata across stale client saves", () => {
    const existing = {
      engineMeta: { engineName: "builder", model: "claude-sonnet-4" },
      _debugRuns: [{ runId: "run-1" }],
      messages: [
        {
          id: "user-1",
          role: "user",
          content: [{ type: "text", text: "start" }],
        },
      ],
    };
    const staleIncoming = {
      messages: [
        {
          id: "user-1",
          role: "user",
          content: [{ type: "text", text: "start" }],
        },
      ],
    };

    const merged = mergeThreadDataForClientSave(existing, staleIncoming);

    expect(merged.engineMeta).toEqual({
      engineName: "builder",
      model: "claude-sonnet-4",
    });
    expect(merged._debugRuns).toEqual([{ runId: "run-1" }]);
  });

  it("can treat queued messages as authoritative when clearing the queue", () => {
    const existing = {
      queuedMessages: [{ id: "queued", text: "next" }],
      messages: [
        {
          id: "user-1",
          role: "user",
          content: [{ type: "text", text: "start" }],
        },
      ],
    };
    const incoming = {
      messages: [
        {
          id: "user-1",
          role: "user",
          content: [{ type: "text", text: "start" }],
        },
      ],
    };

    const merged = mergeThreadDataForClientSave(existing, incoming, {
      preserveExistingQueuedMessages: false,
    });

    expect(merged.queuedMessages).toBeUndefined();
  });

  it("dedupes a client-save user message against the server's submittedRunId copy of the same prompt", () => {
    // The runtime's saveThreadData PUT sends the runtime export, which
    // assigns every user message `attachments: []`. The server's
    // `persistSubmittedUserMessage` → `buildUserMessage` writes the same
    // logical message but omits `attachments` entirely. Without
    // attachment normalization in `messageIdentityKeys`, the merge sees
    // them as different fingerprints and keeps both, producing a duplicate
    // user-message row per turn (observed on slides prod: every turn
    // ended up as `client_user → assistant → server_user`).
    const existing = {
      messages: [
        {
          message: {
            id: "server-user-run-2026-05-10",
            role: "user",
            content: [{ type: "text", text: "make me a deck about pumpkins" }],
            metadata: { custom: { submittedRunId: "run-2026-05-10" } },
          },
          parentId: null,
        },
      ],
    };
    const incoming = {
      messages: [
        {
          message: {
            id: "client-runtime-id",
            role: "user",
            content: [{ type: "text", text: "make me a deck about pumpkins" }],
            attachments: [],
            metadata: { custom: {} },
          },
          parentId: null,
        },
      ],
    };

    const merged = mergeThreadDataForClientSave(existing, incoming);

    expect(merged.messages).toHaveLength(1);
    expect(merged.messages[0].message.id).toBe("client-runtime-id");
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

    expect(merged.messages).toHaveLength(1);
    expect(merged.messages[0].message.id).toBe("server-run-1");
    expect(merged.messages[0].message.content).toEqual([
      { type: "text", text: "Final answer" },
    ]);
  });

  it("dedupes a clean client tool-call turn against the server fold of the same turn", () => {
    // Regression: the server now scopes rebuilt tool-call ids by run
    // (`${runId}:tc_1`) while the client's live stream uses a bare counter
    // (`tc_1`). A cleanly-completed client export carries neither runId nor
    // turnId (only requestMode), so without stripping the render-only id from
    // the dedup fingerprint these two copies of ONE turn no longer match and the
    // turn renders twice. The fingerprint must ignore toolCallId.
    // Server fold of a tool-call turn: runId-scoped tool ids, has runId+turnId.
    const existing = {
      messages: [
        {
          message: {
            id: "server-run-1",
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "run-1:tc_1",
                toolName: "bigquery",
                argsText: '{"sql":"select 1"}',
                args: { sql: "select 1" },
                result: "rows",
              },
            ],
            status: { type: "complete", reason: "stop" },
            metadata: { runId: "run-1", custom: { turnId: "turn-1" } },
          },
          parentId: null,
        },
      ],
    };
    // Client export of the SAME turn after a clean completion: tc_N ids, and the
    // adapter stamps only requestMode (no runId, no turnId).
    const incoming = {
      messages: [
        {
          message: {
            id: "aui-abc",
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "tc_1",
                toolName: "bigquery",
                argsText: '{"sql":"select 1"}',
                args: { sql: "select 1" },
                result: "rows",
              },
            ],
            status: { type: "complete", reason: "stop" },
            metadata: { custom: { requestMode: "chat" } },
          },
          parentId: null,
        },
      ],
    };

    const merged = mergeThreadDataForClientSave(existing, incoming);
    expect(merged.messages).toHaveLength(1);
  });

  it("matches server-persisted user attachments to later client saves by attachment metadata", () => {
    const existing = {
      messages: [
        buildUserMessage({
          text: "Use the attached context.",
          runId: "run-user",
          attachments: [
            {
              type: "file",
              name: "gong-transcript.txt",
              contentType: "text/plain",
              text: "truncated transcript",
            },
          ],
        }),
      ],
    };
    const incoming = {
      messages: [
        {
          id: "client-user",
          role: "user",
          content: [{ type: "text", text: "Use the attached context." }],
          attachments: [
            {
              id: "client-attachment",
              type: "file",
              name: "gong-transcript.txt",
              contentType: "text/plain",
              status: { type: "complete" },
              content: [
                {
                  type: "text",
                  text: '<attachment name="gong-transcript.txt">\nfull transcript\n</attachment>',
                },
              ],
            },
          ],
        },
      ],
    };

    const merged = mergeThreadDataForClientSave(existing, incoming);

    expect(merged.messages).toHaveLength(1);
    expect(merged.messages[0].message.id).toBe("client-user");
  });

  it("rewrites assistant parent links when a duplicate server user id is replaced by the client id", () => {
    const existing = {
      messages: [
        {
          message: {
            id: "server-user-run-1",
            role: "user",
            content: [{ type: "text", text: "make this slide punchier" }],
            metadata: { custom: { submittedRunId: "run-1" } },
          },
          parentId: null,
        },
        {
          message: {
            id: "server-run-1",
            role: "assistant",
            content: [{ type: "text", text: "Done." }],
            status: { type: "complete", reason: "stop" },
            metadata: { runId: "run-1" },
          },
          parentId: "server-user-run-1",
        },
      ],
    };
    const incoming = {
      messages: [
        {
          message: {
            id: "client-user-1",
            role: "user",
            content: [{ type: "text", text: "make this slide punchier" }],
            attachments: [],
            metadata: { custom: {} },
          },
          parentId: null,
        },
      ],
    };

    const merged = mergeThreadDataForClientSave(existing, incoming);

    expect(merged.messages.map((entry: any) => entry.message.id)).toEqual([
      "client-user-1",
      "server-run-1",
    ]);
    expect(merged.messages[1].parentId).toBe("client-user-1");
  });
});

describe("normalizeThreadRepository", () => {
  it("wraps legacy flat messages and repairs missing parent links", () => {
    const normalized = normalizeThreadRepository({
      headId: "missing-head",
      messages: [
        {
          id: "user-1",
          role: "user",
          content: [{ type: "text", text: "start" }],
        },
        {
          message: {
            id: "assistant-1",
            role: "assistant",
            content: [{ type: "text", text: "done" }],
            status: { type: "complete", reason: "stop" },
          },
          parentId: "does-not-exist",
        },
      ],
    });

    expect(normalized.headId).toBe("assistant-1");
    expect(normalized.messages).toEqual([
      expect.objectContaining({
        parentId: null,
        message: expect.objectContaining({ id: "user-1" }),
      }),
      expect.objectContaining({
        parentId: "user-1",
        message: expect.objectContaining({ id: "assistant-1" }),
      }),
    ]);
  });

  it("deduplicates message ids while keeping the latest message payload", () => {
    const normalized = normalizeThreadRepository({
      headId: "missing-head",
      messages: [
        {
          message: {
            id: "user-1",
            role: "user",
            content: [{ type: "text", text: "old prompt" }],
          },
          parentId: null,
        },
        {
          message: {
            id: "assistant-1",
            role: "assistant",
            content: [{ type: "text", text: "answer" }],
            status: { type: "complete", reason: "stop" },
          },
          parentId: "user-1",
        },
        {
          message: {
            id: "user-1",
            role: "user",
            content: [{ type: "text", text: "newer prompt" }],
          },
          parentId: null,
        },
      ],
    });

    expect(normalized.messages.map((entry: any) => entry.message.id)).toEqual([
      "user-1",
      "assistant-1",
    ]);
    expect(normalized.messages[0]).toEqual(
      expect.objectContaining({
        parentId: null,
        message: expect.objectContaining({
          id: "user-1",
          content: [{ type: "text", text: "newer prompt" }],
        }),
      }),
    );
    expect(normalized.messages[1]).toEqual(
      expect.objectContaining({
        parentId: "user-1",
        message: expect.objectContaining({ id: "assistant-1" }),
      }),
    );
    expect(normalized.headId).toBe("assistant-1");
  });

  it("deduplicates persisted assistant tool call ids", () => {
    const normalized = normalizeThreadRepository({
      messages: [
        {
          message: {
            id: "assistant-1",
            role: "assistant",
            content: [
              { type: "tool-call", toolCallId: "tc_1", toolName: "search" },
              { type: "tool-call", toolCallId: "tc_1", toolName: "search" },
              { type: "tool-call", toolCallId: "tc_1", toolName: "search" },
            ],
          },
          parentId: null,
        },
      ],
    });

    expect(
      normalized.messages[0].message.content.map(
        (part: any) => part.toolCallId,
      ),
    ).toEqual(["tc_1", "tc_1__dedup_2", "tc_1__dedup_3"]);
  });
});

describe("buildRepositoryFromCodeAgentTranscript", () => {
  it("builds assistant-ui repository entries from Code transcript turns", () => {
    const repo = buildRepositoryFromCodeAgentTranscript([
      {
        id: "evt-user",
        runId: "run-code",
        kind: "user",
        message: "Fix the bug",
        createdAt: "2026-05-17T12:00:00.000Z",
        metadata: {
          attachments: [
            {
              name: "notes.txt",
              type: "text/plain",
              text: "stack trace",
            },
          ],
        },
      },
      {
        id: "evt-assistant",
        runId: "run-code",
        kind: "system",
        message: "I found the issue.",
        createdAt: "2026-05-17T12:00:01.000Z",
        metadata: { role: "assistant" },
      },
      {
        id: "evt-thinking",
        runId: "run-code",
        kind: "status",
        message: "I should run the focused test.",
        createdAt: "2026-05-17T12:00:01.500Z",
        metadata: { type: "thinking" },
      },
      {
        id: "evt-tool-start",
        runId: "run-code",
        kind: "status",
        message: "Running tests.",
        createdAt: "2026-05-17T12:00:02.000Z",
        metadata: { type: "tool_start", tool: "test", input: { file: "x" } },
      },
      {
        id: "evt-tool-done",
        runId: "run-code",
        kind: "status",
        message: "Finished tests.",
        createdAt: "2026-05-17T12:00:03.000Z",
        metadata: { type: "tool_done", tool: "test", result: "ok" },
      },
    ]);

    expect(repo.messages).toHaveLength(2);
    expect(repo.messages[0]?.message.role).toBe("user");
    expect(repo.messages[0]?.message.attachments?.[0]?.name).toBe("notes.txt");
    expect(repo.messages[1]?.message.role).toBe("assistant");
    expect(repo.messages[1]?.message.content).toEqual([
      { type: "text", text: "I found the issue." },
      { type: "reasoning", text: "I should run the focused test." },
      {
        type: "tool-call",
        toolCallId: "code-tool-evt-tool-start",
        toolName: "test",
        argsText: '{\n  "file": "x"\n}',
        args: { file: "x" },
        result: "ok",
      },
    ]);
    expect(repo.headId).toBe(repo.messages[1]?.message.id);
  });

  it("can hide credential status messages from imported Code history", () => {
    const repo = buildRepositoryFromCodeAgentTranscript(
      [
        {
          id: "evt-status",
          runId: "run-code",
          kind: "status",
          message: "Missing credentials for a provider.",
          createdAt: "2026-05-17T12:00:00.000Z",
          metadata: { type: "error" },
        },
      ],
      { hideCredentialMessages: true },
    );

    expect(repo.messages).toEqual([]);
  });
});

describe("upsertUserMessage", () => {
  it("persists submitted text attachments in assistant-ui attachment shape", () => {
    const message = buildUserMessage({
      text: "Summarize this",
      runId: "run-submit",
      attachments: [
        {
          type: "file",
          name: "notes.txt",
          contentType: "text/plain",
          text: "Call notes",
        },
      ],
    });

    const updated = upsertUserMessage({}, message);

    expect(updated.messages).toEqual([
      expect.objectContaining({
        parentId: null,
        message: expect.objectContaining({
          id: "server-user-run-submit",
          role: "user",
          content: [{ type: "text", text: "Summarize this" }],
          attachments: [
            expect.objectContaining({
              name: "notes.txt",
              contentType: "text/plain",
              content: [
                {
                  type: "text",
                  text: '<attachment name="notes.txt" contentType="text/plain" type="file">\nCall notes\n</attachment>',
                },
              ],
            }),
          ],
        }),
      }),
    ]);
    expect(updated.headId).toBe("server-user-run-submit");
  });

  it("does not duplicate the latest same submitted user message", () => {
    const message = buildUserMessage({
      text: "Use the attached context.",
      runId: "run-submit",
      attachments: [
        {
          type: "file",
          name: "source.txt",
          contentType: "text/plain",
          text: "Source",
        },
      ],
    });

    const updated = upsertUserMessage({ messages: [message] }, message);

    expect(updated.messages).toHaveLength(1);
  });

  it("still appends a repeated prompt after an assistant reply", () => {
    const message = buildUserMessage({
      text: "continue",
      runId: "run-repeat",
    });
    const repo = {
      messages: [
        buildUserMessage({ text: "continue", runId: "run-old" }),
        {
          id: "assistant-old",
          role: "assistant",
          content: [{ type: "text", text: "Sure." }],
          status: { type: "complete", reason: "stop" },
        },
      ],
    };

    const updated = upsertUserMessage(repo, message);

    expect(updated.messages).toHaveLength(3);
    expect(updated.messages[2].message).toMatchObject({
      id: "server-user-run-repeat",
      role: "user",
    });
  });

  it("stores image attachments as URL references when a hosted URL exists", () => {
    // Simulate a pre-uploaded image: the `url` property has been injected by
    // preUploadAttachments; base64 `data` is still present for the current turn.
    const attWithUrl = {
      type: "image",
      name: "screenshot.png",
      contentType: "image/png",
      data: "data:image/png;base64,abc123",
    };
    (attWithUrl as any).url = "https://cdn.example.com/screenshot.png";
    (attWithUrl as any).uploadProvider = "builder";

    const message = buildUserMessage({
      text: "Describe this image",
      runId: "run-url-img",
      attachments: [attWithUrl as any],
    });

    const updated = upsertUserMessage({}, message);
    const storedAtt = updated.messages[0].message.attachments?.[0];
    expect(storedAtt).toBeDefined();
    // Content should use the hosted URL, not the base64 string.
    expect(storedAtt.content[0]).toEqual({
      type: "image",
      image: "https://cdn.example.com/screenshot.png",
    });
    // Reference metadata must be present for tooling.
    expect(storedAtt.metadata).toMatchObject({
      uploadUrl: "https://cdn.example.com/screenshot.png",
      uploadProvider: "builder",
    });
  });

  it("stores file attachments as URL references when a hosted URL exists", () => {
    const attWithUrl = {
      type: "file",
      name: "report.pdf",
      contentType: "application/pdf",
      data: "data:application/pdf;base64,JVBERi0x",
    };
    (attWithUrl as any).url = "https://cdn.example.com/report.pdf";
    (attWithUrl as any).uploadProvider = "builder";

    const message = buildUserMessage({
      text: "Summarize this PDF",
      runId: "run-url-file",
      attachments: [attWithUrl as any],
    });

    const updated = upsertUserMessage({}, message);
    const storedAtt = updated.messages[0].message.attachments?.[0];
    expect(storedAtt).toBeDefined();
    expect(storedAtt.content[0]).toMatchObject({
      type: "file",
      url: "https://cdn.example.com/report.pdf",
    });
    expect(storedAtt.metadata).toMatchObject({
      uploadUrl: "https://cdn.example.com/report.pdf",
    });
  });

  it("stores reference-only uploaded SVGs as file URL references", () => {
    const attWithUrl = {
      type: "image",
      name: "logo.svg",
      contentType: "image/svg+xml",
      data: "data:image/svg+xml;base64,PHN2Zy8+",
    };
    (attWithUrl as any).url = "https://cdn.example.com/logo.svg";
    (attWithUrl as any).uploadProvider = "builder";
    (attWithUrl as any).referenceOnly = true;
    (attWithUrl as any).securityNote =
      "SVG content may contain active markup; use this URL as a file reference unless the target app sanitizes it.";

    const message = buildUserMessage({
      text: "Use this logo",
      runId: "run-url-svg",
      attachments: [attWithUrl as any],
    });

    const updated = upsertUserMessage({}, message);
    const storedAtt = updated.messages[0].message.attachments?.[0];
    expect(storedAtt).toBeDefined();
    expect(storedAtt.type).toBe("file");
    expect(storedAtt.content[0]).toMatchObject({
      type: "file",
      url: "https://cdn.example.com/logo.svg",
      mimeType: "image/svg+xml",
    });
    expect(storedAtt.metadata).toMatchObject({
      uploadUrl: "https://cdn.example.com/logo.svg",
      uploadProvider: "builder",
      referenceOnly: true,
      securityNote: expect.stringContaining("active markup"),
    });
  });

  it("caps base64 image data larger than 2 MB when no URL exists", () => {
    // Generate a fake base64 string that's clearly over 2 MB of decoded bytes.
    // 2 MB = 2097152 bytes; base64 is 4/3 of that ≈ 2796203 chars.
    const bigB64 = "A".repeat(3_000_000);
    const att = {
      type: "image",
      name: "big.png",
      contentType: "image/png",
      data: `data:image/png;base64,${bigB64}`,
    };

    const message = buildUserMessage({
      text: "big image",
      runId: "run-big-img",
      attachments: [att as any],
    });

    const storedAtt = message.attachments?.[0];
    expect(storedAtt).toBeDefined();
    const img = storedAtt.content[0].image as string;
    // The stored value must NOT contain the raw big base64.
    expect(img).not.toContain("A".repeat(100));
    expect(img).toContain("[base64 truncated");
  });
});
