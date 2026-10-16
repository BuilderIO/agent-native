import assert from "node:assert/strict";
import test from "node:test";

import { inspectPersistedAssistantProvenance } from "./persisted-assistant-provenance";

test("counts protocol tool-call references once per event", () => {
  const result = inspectPersistedAssistantProvenance({
    threadData: {
      messages: [
        {
          id: "fixture-root",
          role: "assistant",
          metadata: { runId: "fixture-run" },
        },
      ],
      agentKit: {
        messages: [{ id: "fixture-sdk", role: "assistant" }],
        events: [
          {
            type: "tool.started",
            runId: "fixture-run",
            toolCall: {
              id: "fixture-tool",
              name: "fixture",
              status: "running",
              messageId: "fixture-sdk",
            },
          },
          {
            type: "tool.updated",
            runId: "fixture-run",
            messageId: "fixture-sdk",
            message: { id: "fixture-sdk" },
            toolCall: {
              id: "fixture-tool",
              name: "fixture",
              status: "completed",
              messageId: "fixture-sdk",
            },
          },
        ],
        runs: [],
      },
    },
  });
  assert.equal(result.kind, "ok");
  assert.equal(result.scanComplete, true);
  assert.equal(result.snapshotAssistants[0]?.anyEventReferenceCount, 2);
  assert.equal(
    result.snapshotAssistants[0]?.otherEventSameRunRootMatchCount,
    2,
  );
  assert.equal(result.snapshotAssistants[0]?.runIdPresent, false);
  assert.equal(result.snapshotAssistants[0]?.completionProven, false);
  assert.equal(JSON.stringify(result).includes("fixture-"), false);
});

test("counts other events once when multiple root assistants share a run", () => {
  const result = inspectPersistedAssistantProvenance({
    threadData: {
      messages: ["fixture-root-a", "fixture-root-b", "fixture-root-c"].map(
        (id, index) => ({
          id,
          role: "assistant",
          metadata: { runId: index < 2 ? "fixture-run-a" : "fixture-run-b" },
        }),
      ),
      agentKit: {
        messages: [{ id: "fixture-sdk", role: "assistant" }],
        events: [
          "fixture-run-a",
          "fixture-run-a",
          "fixture-run-b",
          "fixture-unrelated-run",
        ].map((runId) => ({
          type: "tool.started",
          runId,
          toolCall: { messageId: "fixture-sdk" },
        })),
        runs: [],
      },
    },
  });
  assert.equal(result.kind, "ok");
  assert.equal(result.rootAssistantCount, 3);
  assert.equal(result.snapshotAssistants[0]?.anyEventReferenceCount, 4);
  assert.equal(
    result.snapshotAssistants[0]?.otherEventSameRunRootMatchCount,
    3,
  );
  assert.equal(result.snapshotAssistants[0]?.completionProven, false);
});

test("counts the declared action invocation message reference", () => {
  const result = inspectPersistedAssistantProvenance({
    threadData: {
      messages: [
        {
          id: "fixture-root",
          role: "assistant",
          metadata: { runId: "fixture-run" },
        },
      ],
      agentKit: {
        messages: [{ id: "fixture-sdk", role: "assistant" }],
        events: [
          {
            type: "action.started",
            runId: "fixture-run",
            messageId: "fixture-sdk",
            invocation: {
              id: "fixture-action",
              action: "fixture",
              threadId: "fixture-thread",
              messageId: "fixture-sdk",
            },
          },
        ],
        runs: [],
      },
    },
  });
  assert.equal(result.snapshotAssistants[0]?.anyEventReferenceCount, 1);
  assert.equal(
    result.snapshotAssistants[0]?.otherEventSameRunRootMatchCount,
    1,
  );
  assert.equal(result.snapshotAssistants[0]?.completionProven, false);
});

test("rejects missing or invalid event types while allowing opaque custom event payloads", () => {
  const inspect = (event: unknown) =>
    inspectPersistedAssistantProvenance({
      threadData: {
        messages: [],
        agentKit: { messages: [], events: [event], runs: [] },
      },
    });
  for (const event of [{}, { type: 123 }, { type: "" }, { type: "   " }]) {
    const result = inspect(event);
    assert.equal(result.kind, "unreadable");
    assert.equal(result.scanComplete, false);
    assert.equal(result.events.unreadableCount, 1);
    assert.equal(result.events.unreadable, true);
  }
  const custom = inspect({
    type: "fixture.custom",
    payload: "PRIVATE_PAYLOAD",
  });
  assert.equal(custom.kind, "ok");
  assert.equal(custom.scanComplete, true);
  assert.equal(custom.events.unreadableCount, 0);
  assert.equal(JSON.stringify(custom).includes("PRIVATE_PAYLOAD"), false);
});

test("measures submitted-user inference only for unique users without another run candidate", () => {
  const user = {
    id: "fixture-root-user",
    role: "user",
    metadata: {
      custom: {
        agentKitMessageId: "fixture-sdk-user",
        submittedRunId: "fixture-run",
      },
    },
  };
  const root = {
    id: "fixture-root-answer",
    role: "assistant",
    metadata: { runId: "fixture-run" },
  };
  const inspect = (
    users: unknown[],
    messages: unknown[],
    events: unknown[] = [],
    runs: unknown[] = [],
  ) =>
    inspectPersistedAssistantProvenance({
      threadData: {
        messages: [...users, root],
        agentKit: { messages, events, runs },
      },
    });
  const sdkUser = { id: "fixture-sdk-user", role: "user" };
  const prefix = {
    id: "fixture-prefix",
    role: "assistant",
    content: "fixture prefix",
  };
  const known = inspect([user], [sdkUser, prefix]);
  assert.equal(
    known.snapshotAssistants[0]?.submittedUserInferredRootRunMatchCount,
    1,
  );
  assert.equal(known.snapshotAssistants[0]?.runIdPresent, false);
  assert.equal(known.snapshotAssistants[0]?.completionProven, false);
  assert.equal(known.scanComplete, true);
  for (const result of [
    inspect([user], [{ id: "fixture-unknown", role: "user" }, prefix]),
    inspect([user, user], [sdkUser, prefix]),
    inspect([user], [sdkUser, prefix, sdkUser]),
    inspect([user], [sdkUser, { role: "user" }, prefix]),
    inspect(
      [user],
      [sdkUser, { ...prefix, metadata: { runId: "fixture-other" } }],
    ),
    inspect(
      [user],
      [sdkUser, prefix],
      [
        {
          type: "message.created",
          runId: "fixture-other",
          message: { id: "fixture-prefix", role: "assistant" },
        },
      ],
    ),
    inspect(
      [user],
      [sdkUser, prefix],
      [],
      [{ id: "fixture-other", activeMessageId: "fixture-prefix" }],
    ),
  ])
    assert.equal(
      result.snapshotAssistants[0]?.submittedUserInferredRootRunMatchCount,
      0,
    );
  const fallback = inspect(
    [
      {
        id: "fixture-sdk-user",
        role: "user",
        metadata: { custom: { submittedRunId: "fixture-run" } },
      },
    ],
    [sdkUser, prefix],
  );
  assert.equal(
    fallback.snapshotAssistants[0]?.submittedUserInferredRootRunMatchCount,
    1,
  );
  assert.equal(JSON.stringify(known).includes("fixture-"), false);
});

test("measures native server lineage, aliases, and all event references without inferring completion", () => {
  const result = inspectPersistedAssistantProvenance({
    threadData: {
      messages: [
        {
          id: "fixture-root",
          role: "assistant",
          metadata: {
            runId: "fixture-run",
            custom: { agentKitMessageId: "server-fixture-run" },
          },
        },
      ],
      agentKit: {
        messages: [{ id: "server-fixture-run", role: "assistant" }],
        events: [
          ...[
            "message.delta",
            "reasoning.delta",
            "tool.result",
            "widget.updated",
            "annotation.created",
          ].map((type) => ({
            type,
            messageId: "server-fixture-run",
            message: { id: "server-fixture-run" },
            runId: "fixture-run",
            privateValue: "PRIVATE_EVENT",
          })),
          {
            type: "message.delta",
            messageId: "server-fixture-run",
            message: { id: "fixture-other" },
            runId: "fixture-other-run",
          },
          {
            type: "message.delta",
            message: { id: "server-fixture-run" },
            runId: "fixture-run",
          },
        ],
        runs: [],
      },
    },
  });
  const assistant = result.snapshotAssistants[0];
  assert.equal(assistant?.nativeServerRunRootMessageIdMatchCount, 1);
  assert.equal(assistant?.anyEventReferenceCount, 7);
  assert.equal(assistant?.otherEventSameRunRootMatchCount, 6);
  assert.equal(assistant?.rootAgentKitAliasPresentCount, 1);
  assert.equal(assistant?.rootAgentKitAliasMessageIdMatchCount, 1);
  assert.equal(assistant?.runIdPresent, false);
  assert.equal(assistant?.completionProven, false);
  assert.equal(assistant?.messageCreatedEventCount, 0);
  assert.equal(assistant?.messageCompletedEventCount, 0);
  for (const value of [
    "fixture-run",
    "fixture-root",
    "fixture-other",
    "PRIVATE_EVENT",
  ])
    assert.equal(JSON.stringify(result).includes(value), false);
});

test("keeps malformed and conflicting lineage unknown and bounds reference counts", () => {
  const result = inspectPersistedAssistantProvenance({
    threadData: {
      messages: [
        {
          id: "fixture-conflict",
          role: "assistant",
          metadata: {
            runId: "fixture-run",
            custom: { runId: "fixture-other", agentKitMessageId: "" },
          },
        },
        {
          id: "fixture-malformed",
          role: "assistant",
          metadata: { runId: 123, custom: { agentKitMessageId: 123 } },
        },
      ],
      agentKit: {
        messages: [
          { id: "server-fixture-run", role: "assistant" },
          { id: "", role: "assistant" },
        ],
        events: Array.from({ length: 2049 }, () => ({
          type: "message.delta",
          messageId: "server-fixture-run",
          runId: "fixture-run",
        })),
        runs: [],
      },
    },
  });
  const assistant = result.snapshotAssistants[0];
  assert.equal(assistant?.nativeServerRunRootMessageIdMatchCount, 0);
  assert.equal(assistant?.otherEventSameRunRootMatchCount, 0);
  assert.equal(assistant?.anyEventReferenceCount, 2048);
  assert.equal(assistant?.rootAgentKitAliasPresentCount, 0);
  assert.equal(assistant?.rootAgentKitAliasMessageIdMatchCount, 0);
  assert.equal(result.events.truncated, true);
  assert.equal(result.snapshotAssistants[1]?.anyEventReferenceCount, 0);
});

test("compares direct root identity independently of prefix and completion evidence", () => {
  const result = inspectPersistedAssistantProvenance({
    threadData: {
      messages: [
        {
          id: "fixture-root",
          role: "assistant",
          content: "fixture answer is complete",
          metadata: { runId: "fixture-run" },
        },
      ],
      agentKit: {
        messages: [
          {
            id: "fixture-root",
            role: "assistant",
            content: "fixture answer",
            status: "complete",
          },
          {
            id: "fixture-final",
            role: "assistant",
            content: "fixture answer is complete",
            metadata: { runId: "fixture-run" },
          },
        ],
        events: [
          {
            type: "message.completed",
            runId: "fixture-run",
            message: { id: "fixture-final", role: "assistant" },
          },
        ],
        runs: [{ id: "fixture-run", activeMessageId: "fixture-final" }],
      },
    },
  });
  const [prefix, final] = result.snapshotAssistants;
  assert.equal(prefix?.rootMessageIdMatchCount, 1);
  assert.equal(prefix?.strictPrefixRootMatchCount, 1);
  assert.equal(prefix?.messageStatus, "complete");
  assert.equal(prefix?.runIdPresent, false);
  assert.equal(prefix?.messageCreatedEventCount, 0);
  assert.equal(prefix?.messageCompletedEventCount, 0);
  assert.equal(prefix?.completionProven, false);
  assert.equal(final?.rootMessageIdMatchCount, 0);
  assert.equal(final?.exactRootMatchCount, 1);
  assert.equal(final?.sameRunRootCount, 1);
  assert.equal(final?.completionProven, true);
  assert.equal(final?.activeMessageMatchesPersistedRun, true);
  assert.equal(JSON.stringify(result).includes("fixture-root"), false);
  assert.equal(JSON.stringify(result).includes("fixture-final"), false);
});

test("counts duplicate root identities while retaining ambiguity and absent identity", () => {
  const result = inspectPersistedAssistantProvenance({
    threadData: {
      messages: [
        { id: "fixture-duplicate", role: "assistant" },
        { id: "fixture-duplicate", role: "assistant" },
        { id: "", role: "assistant" },
      ],
      agentKit: {
        messages: [
          { id: "fixture-duplicate", role: "assistant" },
          { id: "fixture-duplicate", role: "assistant" },
          { id: "", role: "assistant" },
          { role: "assistant" },
          { id: 123, role: "assistant" },
        ],
        events: [],
        runs: [],
      },
    },
  });
  assert.deepEqual(
    result.snapshotAssistants.map((message) => message.rootMessageIdMatchCount),
    [2, 2, 0, 0, 0],
  );
  assert.equal(result.snapshotAssistants[0]?.messageIdAmbiguous, true);
  assert.equal(result.snapshotAssistants[1]?.messageIdAmbiguous, true);
  assert.equal(result.snapshotAssistants[0]?.runIdAmbiguous, true);
  assert.equal(JSON.stringify(result).includes("fixture-duplicate"), false);
});

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
  assert.equal(result.snapshotAssistants[0]?.anyEventReferenceCount, 1);
  assert.equal(result.snapshotAssistants[0]?.messageCompletedEventCount, 0);
  assert.equal(result.snapshotAssistants[1]?.messageCreatedEventCount, 1);
  assert.equal(result.snapshotAssistants[1]?.messageCompletedEventCount, 1);
  assert.equal(result.snapshotAssistants[1]?.anyEventReferenceCount, 2);
  assert.equal(
    result.snapshotAssistants[1]?.otherEventSameRunRootMatchCount,
    0,
  );
  assert.equal(result.snapshotAssistants[1]?.messageStatus, "completed");
  assert.equal(result.snapshotAssistants[1]?.rootMessageIdMatchCount, 0);
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
  assert.equal(absent.scanComplete, true);
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
  assert.equal(empty.scanComplete, true);
  assert.equal(empty.rootMessages.state, "present");
  assert.equal(empty.rootMessages.total, 0);
  assert.equal(empty.events.state, "present");

  const malformed = inspectPersistedAssistantProvenance({
    threadData: {
      messages: {},
      agentKit: { messages: [], events: {}, runs: [] },
    },
  });
  assert.equal(malformed.kind, "unreadable");
  assert.equal(malformed.scanComplete, false);
  assert.equal(malformed.reason, "messages-shape");
  assert.equal(malformed.rootMessages.state, "unreadable");
  assert.equal(malformed.events.state, "unreadable");
  assert.equal(malformed.events.unreadable, true);

  for (const collection of ["messages", "events", "runs"]) {
    for (const value of [{}, [null]]) {
      const partial = inspectPersistedAssistantProvenance({
        threadData: {
          messages: [{ id: "fixture-root", role: "assistant" }],
          agentKit: {
            messages: [{ id: "fixture-snapshot", role: "assistant" }],
            events: [],
            runs: [],
            [collection]: value,
          },
        },
      });
      assert.equal(partial.kind, "unreadable");
      assert.equal(partial.scanComplete, false);
      assert.equal(partial.reason, "messages-shape");
      assert.equal(partial.rootAssistantCount, 1);
      if (collection !== "messages") {
        assert.equal(partial.snapshotAssistantCount, 1);
        assert.equal(partial.snapshotAssistants.length, 1);
      }
    }
  }
  const legacy = inspectPersistedAssistantProvenance({
    threadData: {
      messages: [{ role: "assistant", content: "fixture legacy" }],
    },
  });
  assert.equal(legacy.kind, "ok");
  assert.equal(legacy.scanComplete, true);
  assert.equal(legacy.events.state, "absent");
  assert.equal(legacy.runs.state, "absent");

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
  assert.equal(missingEventRole.kind, "unreadable");
  assert.equal(
    missingEventRole.snapshotAssistants[0]?.messageCompletedEventCount,
    0,
  );
  assert.equal(missingEventRole.snapshotAssistants[0]?.completionProven, false);

  const unreadable = inspectPersistedAssistantProvenance({
    threadData: '{"private":"PRIVATE_INVALID_JSON"',
  });
  assert.equal(unreadable.kind, "unreadable");
  assert.equal(unreadable.scanComplete, false);
  assert.equal(unreadable.reason, "invalid-json");
  assert.equal(
    JSON.stringify(unreadable).includes("PRIVATE_INVALID_JSON"),
    false,
  );
});

test("marks independently bounded or unreadable text and collection scans incomplete", () => {
  const assistant = {
    id: "fixture-message",
    role: "assistant",
    content: "fixture",
  };
  for (const messages of [
    [{ ...assistant, content: "x".repeat(65_537) }],
    [{ ...assistant, content: [{ type: "text", text: 123 }] }],
    [
      {
        ...assistant,
        content: Array.from({ length: 129 }, () => ({
          type: "text",
          text: "fixture",
        })),
      },
    ],
    Array.from({ length: 257 }, () => assistant),
  ]) {
    for (const root of [true, false]) {
      const result = inspectPersistedAssistantProvenance({
        threadData: {
          messages: root ? messages : [assistant],
          agentKit: {
            messages: root ? [assistant] : messages,
            events: [],
            runs: [],
          },
        },
      });
      assert.equal(result.kind, "ok");
      assert.equal(result.scanComplete, false);
    }
  }
  for (const collection of ["events", "runs"]) {
    const result = inspectPersistedAssistantProvenance({
      threadData: {
        messages: [assistant],
        agentKit: {
          messages: [assistant],
          events: [],
          runs: [],
          [collection]: Array.from(
            { length: collection === "events" ? 2049 : 257 },
            () =>
              collection === "events"
                ? { type: "run.started" }
                : { id: "fixture-run" },
          ),
        },
      },
    });
    assert.equal(result.kind, "ok");
    assert.equal(result.scanComplete, false);
  }
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
  assert.equal(result.kind, "ok");
  assert.equal(result.scanComplete, false);
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
