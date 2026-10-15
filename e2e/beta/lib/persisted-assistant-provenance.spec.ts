import assert from "node:assert/strict";
import test from "node:test";

import { inspectPersistedAssistantProvenance } from "./persisted-assistant-provenance";

test("distinguishes an unfinished prefix from a separately completed prefix", () => {
  const body = {
    threadData: JSON.stringify({
      messages: [
        {
          id: "fixture-root-assistant",
          role: "assistant",
          metadata: { runId: "fixture-run" },
          content: [{ type: "text", text: "fixture answer is complete" }],
        },
      ],
      agentKit: {
        messages: [
          {
            id: "fixture-unfinished-prefix",
            role: "assistant",
            metadata: { runId: "fixture-run", status: "streaming" },
            parts: [{ type: "text", text: "fixture answer" }],
          },
          {
            id: "fixture-completed-prefix",
            role: "assistant",
            status: { type: "completed" },
            metadata: { runId: "fixture-run", status: "completed" },
            parts: [{ type: "text", text: "fixture answer" }],
          },
        ],
        events: [
          {
            type: "message.created",
            runId: "fixture-run",
            message: { id: "fixture-unfinished-prefix", role: "assistant" },
          },
          {
            type: "message.created",
            runId: "fixture-run",
            message: { id: "fixture-completed-prefix", role: "assistant" },
          },
          {
            type: "message.completed",
            runId: "fixture-run",
            message: { id: "fixture-completed-prefix", role: "assistant" },
          },
          ...Array.from({ length: 9 }, () => ({ type: "run.started" })),
          {
            type: "message.created",
            runId: "fixture-other-run",
            message: { id: "fixture-event-id-a", role: "assistant" },
            messageId: "fixture-event-id-b",
          },
        ],
        runs: [
          {
            id: "fixture-run",
            status: "running",
            activeMessageId: "fixture-unfinished-prefix",
          },
        ],
      },
    }),
  };

  const result = inspectPersistedAssistantProvenance(body);

  assert.equal(result.kind, "ok");
  if (result.kind !== "ok") return;
  assert.equal(result.rootAssistantCount, 1);
  assert.equal(result.snapshotAssistantCount, 2);
  assert.equal(result.events.total, 13);
  assert.deepEqual(
    result.snapshotAssistants.map((assistant) => ({
      strictPrefixRootMatchCount: assistant.strictPrefixRootMatchCount,
      sameRunRootCount: assistant.sameRunRootCount,
      completionProven: assistant.completionProven,
      activeMessageCompared: assistant.activeMessageCompared,
      activeMessageMatchesPersistedRun:
        assistant.activeMessageMatchesPersistedRun,
    })),
    [
      {
        strictPrefixRootMatchCount: 1,
        sameRunRootCount: 1,
        completionProven: false,
        activeMessageCompared: true,
        activeMessageMatchesPersistedRun: true,
      },
      {
        strictPrefixRootMatchCount: 1,
        sameRunRootCount: 1,
        completionProven: true,
        activeMessageCompared: true,
        activeMessageMatchesPersistedRun: false,
      },
    ],
  );
  assert.equal(result.events.ambiguousIdCount, 2);
  assert.equal(result.snapshotAssistants[0]?.messageCreatedEventCount, 1);
  assert.equal(result.snapshotAssistants[0]?.messageCompletedEventCount, 0);
  assert.equal(result.snapshotAssistants[1]?.messageCreatedEventCount, 1);
  assert.equal(result.snapshotAssistants[1]?.messageCompletedEventCount, 1);
  assert.equal(result.snapshotAssistants[1]?.messageStatus, "completed");
});

test("keeps unknown run provenance distinct from conflicting provenance", () => {
  const unknownRun = inspectPersistedAssistantProvenance({
    threadData: {
      messages: [],
      agentKit: {
        messages: [
          {
            id: "fixture-unknown-run",
            role: "assistant",
            content: "done",
            status: "streaming",
          },
        ],
        events: [
          {
            type: "message.completed",
            message: { id: "fixture-unknown-run", role: "assistant" },
          },
        ],
        runs: [],
      },
    },
  });
  assert.equal(unknownRun.kind, "ok");
  assert.equal(unknownRun.snapshotAssistants[0]?.runIdPresent, false);
  assert.equal(unknownRun.snapshotAssistants[0]?.runIdAmbiguous, false);
  assert.equal(unknownRun.snapshotAssistants[0]?.completionProven, true);
  assert.equal(unknownRun.snapshotAssistants[0]?.messageStatus, "streaming");

  const conflictingRun = inspectPersistedAssistantProvenance({
    threadData: {
      messages: [],
      agentKit: {
        messages: [
          {
            id: "fixture-conflicting-run",
            role: "assistant",
            metadata: { runId: "fixture-run-a" },
          },
        ],
        events: [
          {
            type: "message.completed",
            runId: "fixture-run-b",
            message: { id: "fixture-conflicting-run", role: "assistant" },
          },
        ],
        runs: [],
      },
    },
  });
  assert.equal(conflictingRun.snapshotAssistants[0]?.runIdPresent, true);
  assert.equal(conflictingRun.snapshotAssistants[0]?.runIdAmbiguous, true);
  assert.equal(conflictingRun.snapshotAssistants[0]?.completionProven, false);

  const conflictingRunsWithoutMessageId = inspectPersistedAssistantProvenance({
    threadData: {
      messages: [],
      agentKit: {
        messages: [
          {
            role: "assistant",
            metadata: {
              runId: "fixture-run-a",
              custom: { runId: "fixture-run-b" },
            },
          },
        ],
        events: [],
        runs: [],
      },
    },
  });
  assert.equal(
    conflictingRunsWithoutMessageId.snapshotAssistants[0]?.messageIdPresent,
    false,
  );
  assert.equal(
    conflictingRunsWithoutMessageId.snapshotAssistants[0]?.runIdPresent,
    true,
  );
  assert.equal(
    conflictingRunsWithoutMessageId.snapshotAssistants[0]?.runIdAmbiguous,
    true,
  );

  const conflictingMessageId = inspectPersistedAssistantProvenance({
    threadData: {
      messages: [],
      agentKit: {
        messages: [{ id: "fixture-message-a", role: "assistant" }],
        events: [
          {
            type: "message.completed",
            message: { id: "fixture-message-a", role: "assistant" },
            messageId: "fixture-message-b",
          },
        ],
        runs: [],
      },
    },
  });
  assert.equal(
    conflictingMessageId.snapshotAssistants[0]?.messageIdAmbiguous,
    true,
  );
  assert.equal(
    conflictingMessageId.snapshotAssistants[0]?.messageCompletedEventCount,
    0,
  );
  assert.equal(
    conflictingMessageId.snapshotAssistants[0]?.completionProven,
    false,
  );
});

test("preserves absent, empty, malformed, and unreadable collections", () => {
  const absent = inspectPersistedAssistantProvenance({
    threadData: { agentKit: { messages: [] } },
  });
  assert.equal(absent.kind, "ok");
  assert.equal(absent.rootMessages.state, "absent");
  assert.equal(absent.snapshotMessages.state, "present");
  assert.equal(absent.events.state, "absent");

  const empty = inspectPersistedAssistantProvenance({
    threadData: {
      messages: [],
      agentKit: { messages: [], events: [], runs: [] },
    },
  });
  assert.equal(empty.kind, "ok");
  assert.equal(empty.rootMessages.state, "present");
  assert.equal(empty.rootMessages.total, 0);
  assert.equal(empty.events.state, "present");

  const malformed = inspectPersistedAssistantProvenance({
    threadData: {
      messages: {},
      agentKit: { messages: [], events: {}, runs: [] },
    },
  });
  assert.equal(malformed.kind, "ok");
  assert.equal(malformed.rootMessages.state, "unreadable");
  assert.equal(malformed.events.state, "unreadable");
  assert.equal(malformed.events.unreadable, true);

  const missingEventRole = inspectPersistedAssistantProvenance({
    threadData: {
      messages: [],
      agentKit: {
        messages: [{ id: "fixture-missing-role", role: "assistant" }],
        events: [
          {
            type: "message.completed",
            message: { id: "fixture-missing-role", type: "assistant" },
          },
        ],
        runs: [],
      },
    },
  });
  assert.equal(missingEventRole.events.unreadable, true);
  assert.equal(
    missingEventRole.snapshotAssistants[0]?.messageCompletedEventCount,
    0,
  );
  assert.equal(missingEventRole.snapshotAssistants[0]?.completionProven, false);

  const unreadable = inspectPersistedAssistantProvenance({
    threadData: '{"private":"PRIVATE_INVALID_JSON"',
  });
  assert.equal(unreadable.kind, "unreadable");
  assert.equal(unreadable.reason, "invalid-json");
  assert.equal(
    JSON.stringify(unreadable).includes("PRIVATE_INVALID_JSON"),
    false,
  );
});

test("bounds collections, text, and parts and emits scalar allowlisted output", () => {
  const roots = Array.from({ length: 257 }, (_, index) => ({
    id: `fixture-private-root-${index}`,
    role: "assistant",
    content: "fixture root",
  }));
  const snapshots = Array.from({ length: 257 }, (_, index) => ({
    id: `fixture-private-snapshot-${index}`,
    role: "assistant",
    status: { type: "PRIVATE_MESSAGE_STATUS" },
    metadata: { status: "PRIVATE_STATUS", unexpected: "PRIVATE_METADATA" },
    parts: Array.from({ length: 129 }, (_, part) => ({
      type: "text",
      text: part === 0 ? `PRIVATE_TEXT_${"x".repeat(65_536)}` : "fixture part",
    })),
    privateUrl: "https://fixture.invalid/private",
  }));
  const events = Array.from({ length: 2_049 }, () => ({ type: "run.started" }));
  const result = inspectPersistedAssistantProvenance({
    threadData: {
      messages: roots,
      agentKit: { messages: snapshots, events, runs: [] },
    },
  });

  assert.equal(result.rootMessages.total, 257);
  assert.equal(result.rootMessages.scanned, 256);
  assert.equal(result.rootMessages.truncated, true);
  assert.equal(result.rootAssistantCount, 256);
  assert.equal(result.snapshotMessages.total, 257);
  assert.equal(result.snapshotMessages.scanned, 256);
  assert.equal(result.snapshotAssistantCount, 256);
  assert.equal(result.events.total, 2_049);
  assert.equal(result.events.scanned, 2_048);
  assert.equal(result.events.truncated, true);
  assert.equal(result.snapshotAssistants[0]?.textLength, 65_536);
  assert.equal(result.snapshotAssistants[0]?.textTruncated, true);
  assert.equal(result.snapshotAssistants[0]?.partsTotal, 129);
  assert.equal(result.snapshotAssistants[0]?.partsScanned, 128);
  assert.equal(result.snapshotAssistants[0]?.partsTruncated, true);
  assert.equal(result.snapshotAssistants[0]?.metadataStatus, "unknown");
  assert.equal(result.snapshotAssistants[0]?.messageStatus, "unknown");
  assert.equal(result.snapshotAssistants[0]?.completionProven, false);

  const allowedStrings = new Set([
    "ok",
    "unreadable",
    "none",
    "invalid-json",
    "response-shape",
    "messages-shape",
    "unknown",
    "present",
    "absent",
    "complete",
    "completed",
    "streaming",
    "running",
    "queued",
    "in_progress",
    "incomplete",
    "error",
    "failed",
    "cancelled",
  ]);
  const visit = (value: unknown): void => {
    assert.notEqual(value, undefined);
    if (Array.isArray(value)) return value.forEach(visit);
    if (value && typeof value === "object")
      return Object.values(value).forEach(visit);
    if (typeof value === "string")
      assert.equal(allowedStrings.has(value), true);
    else
      assert.equal(
        typeof value === "boolean" ||
          (typeof value === "number" && Number.isFinite(value)),
        true,
      );
  };
  visit(result);
  const serialized = JSON.stringify(result);
  for (const privateValue of [
    "fixture-private-root",
    "fixture-private-snapshot",
    "PRIVATE_STATUS",
    "PRIVATE_METADATA",
    "PRIVATE_TEXT",
    "fixture.invalid",
    "privateUrl",
  ])
    assert.equal(serialized.includes(privateValue), false);
});
