import assert from "node:assert/strict";
import test from "node:test";

import {
  checkTranscript,
  composerHoldsPrompt,
  countOccurrences,
  describePersisted,
  describeState,
  exactReplyPrompt,
  inspectActiveRun,
  inspectPersistedThread,
  isIdle,
  lineToken,
  longAnswerPrompt,
  LONG_ANSWER_LINES,
  newNonce,
  scanVisibleText,
  stopControlState,
  summarizeTraffic,
  tail,
  threadDeepLink,
  threadIdFromRequestUrl,
  threadIdFromTraffic,
  threadIdFromUrl,
  type ChatMessageView,
  type ChatState,
  type TrafficEntry,
} from "./chat-reliability-core";

function message(role: string, text: string, busy = false): ChatMessageView {
  return { role, id: null, busy, text };
}

function state(overrides: Partial<ChatState> = {}): ChatState {
  return {
    url: "https://beta.chat.agent-native.com/chat/chat-1",
    composerFound: true,
    composerText: "",
    stopVisible: false,
    sendVisible: true,
    sendEnabled: false,
    currentActivity: [],
    messages: [],
    errorCards: [],
    alerts: [],
    bodyText: "",
    ...overrides,
  };
}

test("reports bounded user identity counts without emitting identities", () => {
  const diagnostic = describeState(
    state({
      messages: [
        { ...message("user", "secret prompt"), id: "server-user-private-id" },
        { ...message("user", "secret prompt"), id: "server-user-private-id" },
        { ...message("user", "secret prompt"), id: "private-local-id" },
        message("user", "secret prompt"),
        {
          ...message("assistant", "secret answer"),
          id: "private-assistant-id",
        },
      ],
    }),
  );
  assert.ok(
    diagnostic.includes(
      'userIdentity={"scannedMessages":5,"truncated":false,"userCount":4,"missingIdCount":1,"distinctIdCount":2,"repeatedIdCount":1,"serverUserCount":2}',
    ),
  );
  assert.doesNotMatch(diagnostic, /private-|secret prompt|secret answer/);
});

test("marks user identity diagnostics truncated at the message scan bound", () => {
  const diagnostic = describeState(
    state({
      messages: Array.from({ length: 257 }, (_, index) => ({
        ...message("user", "prompt"),
        id: `private-${index}`,
      })),
    }),
  );
  assert.ok(
    diagnostic.includes(
      'userIdentity={"scannedMessages":256,"truncated":true,"userCount":256,"missingIdCount":0,"distinctIdCount":256,"repeatedIdCount":0,"serverUserCount":0}',
    ),
  );
});

test("reports bounded assistant identity counts without IDs or answer content", () => {
  const diagnostic = describeState(
    state({
      messages: [
        { ...message("assistant", "private answer"), id: "server-private" },
        { ...message("assistant", "private answer"), id: "private-local" },
        {
          ...message("assistant", "another private answer"),
          id: "private-local",
        },
        message("assistant", ""),
        message("user", "private prompt"),
      ],
    }),
  );
  assert.ok(
    diagnostic.includes(
      'assistantIdentity={"scannedMessages":5,"truncated":false,"assistantCount":4,"missingIdCount":1,"distinctIdCount":2,"repeatedIdCount":1,"serverAssistantCount":1,"repeatedNonemptyTextCount":1}',
    ),
  );
  assert.doesNotMatch(
    diagnostic,
    /server-private|private-local|private answer|private prompt/,
  );
  const bounded = describeState(
    state({
      messages: Array.from({ length: 257 }, (_, index) => ({
        ...message("assistant", ""),
        id: `private-${index}`,
      })),
    }),
  );
  assert.ok(
    bounded.includes(
      'assistantIdentity={"scannedMessages":256,"truncated":true,"assistantCount":256,"missingIdCount":0,"distinctIdCount":256,"repeatedIdCount":0,"serverAssistantCount":0,"repeatedNonemptyTextCount":0}',
    ),
  );
});

test("flags every run-failure string users have reported, case-insensitively", () => {
  for (const text of [
    "code stream_ended",
    "The runtime stream ended before it reported completion.",
    "The agent stopped before finishing",
    "Run already in progress for this thread",
    "ERROR ID: abc",
    "Interrupted before this finished reporting",
    "background_run_lost",
    "run_budget_exhausted",
    "the AGENT STOPPED BEFORE FINISHING",
  ]) {
    const hits = scanVisibleText(`hello\n${text}\nworld`);
    assert.equal(hits[0]?.kind, "run-failure", text);
  }
});

test("flags raw internal errors but not ordinary assistant prose", () => {
  const leaks = [
    "Action update-dashboard failed: Internal server error",
    "Error: <!DOCTYPE html><html>",
    "boom\n    at handler (https://x.test/app.js:10:5)\nnext",
    "TypeError: x is not a function",
  ];
  for (const text of leaks) {
    assert.ok(
      scanVisibleText(text).some((hit) => hit.kind === "internal-leak"),
      text,
    );
  }
  assert.deepEqual(
    scanVisibleText(
      "ABC123-L1: one is the loneliest number.\nABC123-L2: two is a pair of shoes.",
    ),
    [],
  );
});

test("hits carry an excerpt that names where the text was", () => {
  const [hit] = scanVisibleText(
    `before ${"x".repeat(200)} Run already in progress after`,
  );
  assert.equal(hit?.label, "Run already in progress");
  assert.match(hit?.excerpt ?? "", /Run already in progress after/);
});

test("prompts never contain the tokens the assistant must produce", () => {
  const nonce = newNonce();
  const prompt = longAnswerPrompt(nonce);
  assert.ok(prompt.includes(nonce));
  for (const line of [1, 10, LONG_ANSWER_LINES]) {
    assert.equal(prompt.includes(lineToken(nonce, line)), false, `L${line}`);
  }
  assert.deepEqual(scanVisibleText(prompt), []);
  assert.deepEqual(scanVisibleText(exactReplyPrompt(nonce)), []);
  assert.equal(
    /[\/@`]/.test(prompt),
    false,
    "popover or markdown trigger in prompt",
  );
});

test("nonces are unique, uppercase, and safe to type", () => {
  const nonces = new Set(Array.from({ length: 200 }, newNonce));
  assert.equal(nonces.size, 200);
  for (const nonce of nonces) assert.match(nonce, /^[0-9A-F]{10}$/);
});

test("reads the thread id from the three places apps put it", () => {
  assert.equal(
    threadIdFromUrl("https://beta.slides.agent-native.com/?thread=t-1"),
    "t-1",
  );
  assert.equal(
    threadIdFromUrl("https://beta.slides.agent-native.com/?threadId=t-2"),
    "t-2",
  );
  assert.equal(
    threadIdFromUrl("https://beta.chat.agent-native.com/chat/chat-abc?x=1"),
    "chat-abc",
  );
  assert.equal(
    threadIdFromUrl("https://beta.chat.agent-native.com/home"),
    null,
  );
  assert.equal(threadIdFromUrl("not a url"), null);
});

test("reads the thread id from agent-chat API requests", () => {
  const base =
    "https://beta.analytics.agent-native.com/_agent-native/agent-chat";
  assert.equal(threadIdFromRequestUrl(`${base}/threads/t-9`), "t-9");
  assert.equal(threadIdFromRequestUrl(`${base}/threads/t-9/queued`), "t-9");
  assert.equal(
    threadIdFromRequestUrl(`${base}/runs/active?threadId=t-8`),
    "t-8",
  );
  assert.equal(threadIdFromRequestUrl(`${base}/threads?limit=50`), null);
  assert.equal(threadIdFromRequestUrl(`${base}`), null);
});

test("deep links reuse a URL that already addresses the thread", () => {
  const origin = "https://beta.chat.agent-native.com";
  const current = `${origin}/chat/chat-1`;
  assert.equal(threadDeepLink(origin, "/", "chat-1", current), current);
  const link = new URL(
    threadDeepLink(
      "https://beta.analytics.agent-native.com",
      "/",
      "t-5",
      "https://beta.analytics.agent-native.com/?agentSidebar=open",
    ),
  );
  assert.equal(link.searchParams.get("thread"), "t-5");
  assert.equal(link.searchParams.get("agentSidebar"), "open");
});

test("idle means no stop button, no current activity, and no streaming bubble", () => {
  assert.equal(isIdle(state()), true);
  assert.equal(isIdle(state({ composerFound: false })), false);
  assert.equal(isIdle(state({ stopVisible: true })), false);
  assert.equal(isIdle(state({ currentActivity: ["Starting agent"] })), false);
  assert.equal(
    isIdle(state({ messages: [message("assistant", "hi", true)] })),
    false,
  );
  assert.match(
    describeState(
      state({ currentActivity: ["Contacting model"], stopVisible: true }),
    ),
    /Contacting model.*|stop=VISIBLE/,
  );
});

test("Stop is shown, already over, or missing while a run works", () => {
  assert.equal(stopControlState(state({ stopVisible: true })), "shown");
  assert.equal(
    stopControlState(
      state({ stopVisible: true, messages: [message("assistant", "a", true)] }),
    ),
    "shown",
  );
  assert.equal(
    stopControlState(state({ messages: [message("assistant", "all of it")] })),
    "finished",
  );
  assert.equal(
    stopControlState(state({ messages: [message("assistant", "a", true)] })),
    "working-without-stop",
  );
  assert.equal(
    stopControlState(state({ currentActivity: ["Contacting model"] })),
    "working-without-stop",
  );
});

test("a transcript passes when every turn has one prompt and an answer after it", () => {
  const messages = [
    message("user", "Reply with exactly AAA"),
    message("assistant", "AAA"),
    message("user", "Reply with exactly BBB"),
    message("assistant", "BBB"),
  ];
  assert.deepEqual(
    checkTranscript(messages, [
      { userToken: "AAA", answerToken: "AAA" },
      { userToken: "BBB", answerToken: "BBB" },
    ]),
    [],
  );
});

test("a transcript reports duplicates, missing answers, and bad order", () => {
  const duplicated = checkTranscript(
    [
      message("user", "AAA"),
      message("user", "AAA"),
      message("assistant", "AAA"),
    ],
    [{ userToken: "AAA", answerToken: "AAA" }],
  );
  assert.match(duplicated.join("\n"), /2 user bubbles contain AAA/);

  const echoOnly = checkTranscript(
    [message("user", "Reply with exactly AAA")],
    [{ userToken: "AAA", answerToken: "AAA" }],
  );
  assert.match(echoOnly.join("\n"), /no assistant bubble after the prompt AAA/);

  const answerBeforePrompt = checkTranscript(
    [message("assistant", "AAA"), message("user", "AAA")],
    [{ userToken: "AAA", answerToken: "AAA" }],
  );
  assert.match(
    answerBeforePrompt.join("\n"),
    /no assistant bubble after the prompt AAA/,
  );

  const reordered = checkTranscript(
    [
      message("user", "BBB"),
      message("assistant", "BBB"),
      message("user", "AAA"),
      message("assistant", "AAA"),
    ],
    [
      { userToken: "AAA", answerToken: "AAA" },
      { userToken: "BBB", answerToken: "BBB" },
    ],
  );
  assert.match(reordered.join("\n"), /out of order/);

  const repeated = checkTranscript(
    [
      message("user", "AAA"),
      message("assistant", "AAA"),
      message("assistant", "AAA"),
    ],
    [{ userToken: "AAA", answerToken: "AAA" }],
  );
  assert.match(repeated.join("\n"), /duplicate answer/);
  assert.deepEqual(
    checkTranscript(
      [
        message("user", "AAA"),
        message("assistant", "AAA"),
        message("assistant", "AAA"),
      ],
      [{ userToken: "AAA", answerToken: "AAA", allowRepeatedAnswer: true }],
    ),
    [],
  );
});

test("one assistant bubble may answer two queued prompts", () => {
  assert.deepEqual(
    checkTranscript(
      [
        message("user", "AAA"),
        message("user", "BBB"),
        message("assistant", "AAA and BBB"),
      ],
      [
        { userToken: "AAA", answerToken: "AAA", allowRepeatedAnswer: true },
        { userToken: "BBB", answerToken: "BBB", allowRepeatedAnswer: true },
      ],
    ),
    [],
  );
});

test("traffic is grouped, but anything that is not a plain 2xx is listed alone", () => {
  const entries: TrafficEntry[] = [
    {
      atMs: 1000,
      method: "POST",
      path: "/_agent-native/agent-chat",
      query: "",
      status: 200,
    },
    ...Array.from({ length: 5 }, (_, index) => ({
      atMs: 2000 + index * 1000,
      method: "GET",
      path: "/_agent-native/agent-chat/runs/active",
      query: "?threadId=t",
      status: 200,
    })),
    {
      atMs: 9000,
      method: "POST",
      path: "/_agent-native/agent-chat",
      query: "",
      status: 409,
    },
    {
      atMs: 9500,
      method: "GET",
      path: "/_agent-native/agent-chat/threads/t",
      query: "",
      status: null,
      failure: "net::ERR_ABORTED",
    },
  ];
  const summary = summarizeTraffic(entries);
  assert.match(
    summary,
    /GET \/_agent-native\/agent-chat\/runs\/active -> 200 x5/,
  );
  assert.match(summary, /\+9\.0s POST \/_agent-native\/agent-chat -> 409/);
  assert.match(summary, /no response \(net::ERR_ABORTED\)/);
  assert.match(summarizeTraffic([]), /no \/_agent-native\/agent-chat requests/);
});

test("reads a persisted thread and flags messages that never finished", () => {
  const body = {
    title: "Reply with exactly AAA",
    preview: "Reply",
    messageCount: 2,
    threadData: JSON.stringify({
      messages: [
        {
          parentId: null,
          message: {
            id: "u",
            role: "user",
            status: "complete",
            content: [{ type: "text", text: "Reply with exactly AAA" }],
          },
        },
        {
          parentId: "u",
          message: {
            id: "a",
            role: "assistant",
            status: "streaming",
            content: [{ type: "text", text: "AA" }],
          },
        },
      ],
    }),
  };
  const view = inspectPersistedThread(body);
  assert.equal(view.kind, "ok");
  if (view.kind !== "ok") return;
  assert.deepEqual(view.unsettled, ["assistant:streaming"]);
  assert.equal(view.title, "Reply with exactly AAA");
  assert.equal(view.messages[1]?.text, "AA");

  const incomplete = inspectPersistedThread({
    title: "t",
    threadData: JSON.stringify({
      messages: [
        {
          message: {
            role: "assistant",
            status: { type: "incomplete", reason: "error" },
            content: [],
          },
        },
      ],
    }),
  });
  assert.equal(
    incomplete.kind === "ok" && incomplete.unsettled[0],
    "assistant:incomplete",
  );

  const failedSend = inspectPersistedThread({
    title: "t",
    threadData: JSON.stringify({
      agentKit: {
        messages: [
          {
            role: "user",
            status: "error",
            parts: [{ type: "text", text: "x" }],
          },
        ],
      },
    }),
  });
  assert.equal(
    failedSend.kind === "ok" && failedSend.unsettled[0],
    "user:error",
  );
});

test("summarizes bounded root-to-snapshot assistant relations without private values", () => {
  const view = inspectPersistedThread({
    title: "PRIVATE_TITLE_TOKEN",
    threadData: JSON.stringify({
      messages: [
        {
          message: {
            id: "PRIVATE_ROOT_ID",
            role: "assistant",
            metadata: { runId: "PRIVATE_ROOT_RUN" },
            content: [
              { type: "text", text: "PRIVATE_ANSWER_" },
              { type: "text", text: "TOKEN" },
              { type: "tool-call", toolCallId: "PRIVATE_TOOL_ID" },
              { type: "reasoning", text: "PRIVATE_REASONING_TOKEN" },
            ],
          },
          parentId: "PRIVATE_PARENT_ID",
        },
      ],
      agentKit: {
        messages: [
          {
            id: "PRIVATE_EXACT_SNAPSHOT_ID",
            role: "assistant",
            metadata: { runId: "PRIVATE_ROOT_RUN" },
            parts: [{ type: "text", text: "PRIVATE_ANSWER_TOKEN" }],
          },
          {
            id: "PRIVATE_PREFIX_SNAPSHOT_ID",
            role: "assistant",
            metadata: { runId: "PRIVATE_ROOT_RUN" },
            parts: [{ type: "text", text: "PRIVATE_ANSWER" }],
          },
          {
            id: "PRIVATE_DIFFERENT_RUN_ID",
            role: "assistant",
            metadata: { runId: "PRIVATE_OTHER_RUN" },
            parts: [{ type: "text", text: "PRIVATE_ANSWER_TOKEN" }],
          },
        ],
      },
    }),
  });

  assert.equal(view.kind, "ok");
  if (view.kind !== "ok") return;
  assert.deepEqual(view.assistantRelations.relations, [
    {
      rootOrdinal: 1,
      runIdPresent: true,
      runIdAmbiguous: false,
      sameRunSnapshotCandidateCount: 2,
      exactTextMatchCount: 1,
      prefixCompatibleTextMatchCount: 2,
      rootToolPartCount: 1,
      rootReasoningPresent: true,
      rootContentTruncated: false,
      rootPartsTruncated: false,
      snapshotContentTruncatedCount: 0,
    },
  ]);
  assert.equal(view.assistantRelations.ambiguousSnapshotRunIdCount, 0);
  assert.equal(view.assistantRelations.rootMessageCount, 1);
  assert.equal(view.assistantRelations.snapshotMessageCount, 3);

  const description = describePersisted(view);
  assert.match(
    description,
    /^titleLength=19ch messageCount=(?:null|\d+) messages=\[/,
  );
  assert.doesNotMatch(
    description,
    /PRIVATE_(?:TITLE|ROOT|ANSWER|REASONING|TOOL|PARENT|EXACT|PREFIX|DIFFERENT|OTHER)/,
  );
  assert.doesNotMatch(description, /projector/i);
});

test("uses repository-supported run ID metadata and rejects disagreements", () => {
  const view = inspectPersistedThread({
    title: "PRIVATE_METADATA_TITLE",
    threadData: JSON.stringify({
      messages: [
        {
          message: {
            id: "PRIVATE_CUSTOM_ROOT_ID",
            role: "assistant",
            metadata: { custom: { runId: "PRIVATE_CUSTOM_RUN" } },
            content: [{ type: "text", text: "PRIVATE_CUSTOM_ANSWER" }],
          },
        },
        {
          message: {
            id: "PRIVATE_ERROR_ROOT_ID",
            role: "assistant",
            metadata: { runError: { runId: "PRIVATE_ERROR_RUN" } },
            content: [{ type: "text", text: "PRIVATE_ERROR_ANSWER" }],
          },
        },
        {
          message: {
            id: "PRIVATE_CONFLICT_ROOT_ID",
            role: "assistant",
            metadata: {
              runId: "PRIVATE_DIRECT_RUN",
              custom: { runId: "PRIVATE_CUSTOM_CONFLICT_RUN" },
            },
            content: [{ type: "text", text: "PRIVATE_CONFLICT_ANSWER" }],
          },
        },
      ],
      agentKit: {
        messages: [
          {
            id: "PRIVATE_CUSTOM_SNAPSHOT_ID",
            role: "assistant",
            metadata: {
              custom: { runError: { runId: "PRIVATE_CUSTOM_RUN" } },
            },
            parts: [{ type: "text", text: "PRIVATE_CUSTOM_ANSWER" }],
          },
          {
            id: "PRIVATE_ERROR_SNAPSHOT_ID",
            role: "assistant",
            metadata: { custom: { runId: "PRIVATE_ERROR_RUN" } },
            parts: [{ type: "text", text: "PRIVATE_ERROR_ANSWER" }],
          },
          {
            id: "PRIVATE_CONFLICT_SNAPSHOT_ID",
            role: "assistant",
            metadata: { runId: "PRIVATE_DIRECT_RUN" },
            parts: [{ type: "text", text: "PRIVATE_CONFLICT_ANSWER" }],
          },
        ],
        events: [
          {
            type: "message.completed",
            runId: "PRIVATE_DIRECT_RUN",
            message: {
              id: "PRIVATE_CONFLICT_ROOT_ID",
              role: "assistant",
            },
          },
        ],
      },
    }),
  });

  assert.equal(view.kind, "ok");
  if (view.kind !== "ok") return;
  assert.deepEqual(
    view.assistantRelations.relations.map((relation) => ({
      runIdPresent: relation.runIdPresent,
      runIdAmbiguous: relation.runIdAmbiguous,
      sameRunSnapshotCandidateCount: relation.sameRunSnapshotCandidateCount,
      exactTextMatchCount: relation.exactTextMatchCount,
    })),
    [
      {
        runIdPresent: true,
        runIdAmbiguous: false,
        sameRunSnapshotCandidateCount: 1,
        exactTextMatchCount: 1,
      },
      {
        runIdPresent: true,
        runIdAmbiguous: false,
        sameRunSnapshotCandidateCount: 1,
        exactTextMatchCount: 1,
      },
      {
        runIdPresent: false,
        runIdAmbiguous: true,
        sameRunSnapshotCandidateCount: 0,
        exactTextMatchCount: 0,
      },
    ],
  );
  assert.doesNotMatch(describePersisted(view), /PRIVATE_/);
});

test("uses only unique bounded message events when explicit run metadata is missing", () => {
  const view = inspectPersistedThread({
    title: "PRIVATE_EVENT_TITLE",
    threadData: JSON.stringify({
      messages: [
        {
          message: {
            id: "PRIVATE_ROOT_EVENT_ID",
            role: "assistant",
            content: [{ type: "text", text: "PRIVATE_EVENT_ANSWER" }],
          },
        },
        {
          message: {
            id: "PRIVATE_AMBIGUOUS_ROOT_ID",
            role: "assistant",
            content: [{ type: "text", text: "PRIVATE_AMBIGUOUS_ANSWER" }],
          },
        },
        {
          message: {
            id: "PRIVATE_UNATTRIBUTED_ROOT_ID",
            role: "assistant",
            content: [{ type: "text", text: "PRIVATE_UNATTRIBUTED_ANSWER" }],
          },
        },
      ],
      agentKit: {
        messages: [
          {
            id: "PRIVATE_SNAPSHOT_EVENT_ID",
            role: "assistant",
            parts: [{ type: "text", text: "PRIVATE_EVENT_ANSWER" }],
          },
          {
            id: "PRIVATE_AMBIGUOUS_SNAPSHOT_ID",
            role: "assistant",
            parts: [{ type: "text", text: "PRIVATE_AMBIGUOUS_ANSWER" }],
          },
          {
            id: "PRIVATE_NO_EVENT_SNAPSHOT_ID",
            role: "assistant",
            parts: [{ type: "text", text: "PRIVATE_UNATTRIBUTED_ANSWER" }],
          },
        ],
        events: [
          {
            type: "message.completed",
            runId: "PRIVATE_EVENT_RUN",
            message: { id: "PRIVATE_ROOT_EVENT_ID", role: "assistant" },
          },
          {
            type: "message.created",
            runId: "PRIVATE_EVENT_RUN",
            message: { id: "PRIVATE_SNAPSHOT_EVENT_ID", role: "assistant" },
          },
          {
            type: "message.created",
            runId: "PRIVATE_AMBIGUOUS_RUN_A",
            message: { id: "PRIVATE_AMBIGUOUS_ROOT_ID", role: "assistant" },
          },
          {
            type: "message.completed",
            runId: "PRIVATE_AMBIGUOUS_RUN_B",
            message: { id: "PRIVATE_AMBIGUOUS_ROOT_ID", role: "assistant" },
          },
          {
            type: "message.created",
            runId: "PRIVATE_AMBIGUOUS_RUN_A",
            message: {
              id: "PRIVATE_AMBIGUOUS_SNAPSHOT_ID",
              role: "assistant",
            },
          },
          {
            type: "message.completed",
            runId: "PRIVATE_AMBIGUOUS_RUN_B",
            message: {
              id: "PRIVATE_AMBIGUOUS_SNAPSHOT_ID",
              role: "assistant",
            },
          },
        ],
      },
    }),
  });

  assert.equal(view.kind, "ok");
  if (view.kind !== "ok") return;
  assert.equal(view.assistantRelations.ambiguousSnapshotRunIdCount, 1);
  assert.deepEqual(
    view.assistantRelations.relations.map((relation) => ({
      runIdPresent: relation.runIdPresent,
      runIdAmbiguous: relation.runIdAmbiguous,
      sameRunSnapshotCandidateCount: relation.sameRunSnapshotCandidateCount,
      exactTextMatchCount: relation.exactTextMatchCount,
    })),
    [
      {
        runIdPresent: true,
        runIdAmbiguous: false,
        sameRunSnapshotCandidateCount: 1,
        exactTextMatchCount: 1,
      },
      {
        runIdPresent: false,
        runIdAmbiguous: true,
        sameRunSnapshotCandidateCount: 0,
        exactTextMatchCount: 0,
      },
      {
        runIdPresent: false,
        runIdAmbiguous: false,
        sameRunSnapshotCandidateCount: 0,
        exactTextMatchCount: 0,
      },
    ],
  );
  assert.ok(
    view.assistantRelations.relations.every(
      (relation) => !("ambiguousSnapshotRunIdCount" in relation),
    ),
  );
});

test("treats conflicting explicit and event run metadata as ambiguous", () => {
  const view = inspectPersistedThread({
    title: "PRIVATE_CONFLICT_TITLE",
    threadData: JSON.stringify({
      messages: [
        {
          message: {
            id: "PRIVATE_CONFLICT_ROOT_ID",
            role: "assistant",
            metadata: { runId: "PRIVATE_EXPLICIT_RUN" },
            content: [{ type: "text", text: "PRIVATE_CONFLICT_ANSWER" }],
          },
        },
      ],
      agentKit: {
        messages: [
          {
            id: "PRIVATE_CONFLICT_SNAPSHOT_ID",
            role: "assistant",
            metadata: { runId: "PRIVATE_EXPLICIT_RUN" },
            parts: [{ type: "text", text: "PRIVATE_CONFLICT_ANSWER" }],
          },
        ],
        events: [
          {
            type: "message.completed",
            runId: "PRIVATE_EVENT_CONFLICT_RUN",
            message: {
              id: "PRIVATE_CONFLICT_ROOT_ID",
              role: "assistant",
            },
          },
        ],
      },
    }),
  });

  assert.equal(view.kind, "ok");
  if (view.kind !== "ok") return;
  assert.deepEqual(
    {
      runIdPresent: view.assistantRelations.relations[0]?.runIdPresent,
      runIdAmbiguous: view.assistantRelations.relations[0]?.runIdAmbiguous,
      sameRunSnapshotCandidateCount:
        view.assistantRelations.relations[0]?.sameRunSnapshotCandidateCount,
      exactTextMatchCount:
        view.assistantRelations.relations[0]?.exactTextMatchCount,
    },
    {
      runIdPresent: false,
      runIdAmbiguous: true,
      sameRunSnapshotCandidateCount: 0,
      exactTextMatchCount: 0,
    },
  );
  assert.doesNotMatch(describePersisted(view), /PRIVATE_/);
});

test("caps assistant relations, snapshot messages, events, parts, and compared content", () => {
  const longRootText = `${"R".repeat(16_384)}PRIVATE_ROOT_TAIL`;
  const longSnapshotText = `${"R".repeat(16_384)}PRIVATE_SNAPSHOT_TAIL`;
  const rootMessages = Array.from({ length: 35 }, (_, index) => ({
    message: {
      id: index === 1 ? "PRIVATE_LATE_EVENT_ROOT_ID" : `PRIVATE_ROOT_${index}`,
      role: "assistant",
      ...(index === 0
        ? { metadata: { runId: "PRIVATE_LONG_RUN" } }
        : index === 1
          ? { metadata: { runId: "PRIVATE_LATE_EVENT_EXPLICIT_RUN" } }
          : {}),
      content:
        index === 0
          ? [
              { type: "text", text: longRootText },
              ...Array.from({ length: 1_024 }, (_, partIndex) => ({
                type: "tool-call",
                toolCallId: `PRIVATE_ROOT_PART_${partIndex}`,
              })),
            ]
          : [{ type: "text", text: "PRIVATE_SHORT_ROOT" }],
    },
  }));
  const snapshotMessages = Array.from({ length: 257 }, (_, index) => ({
    id: `PRIVATE_SNAPSHOT_${index}`,
    role: "assistant",
    metadata: {
      runId: index === 0 ? "PRIVATE_LONG_RUN" : `PRIVATE_OTHER_RUN_${index}`,
    },
    parts: [
      {
        type: "text",
        text: index === 0 ? longSnapshotText : "PRIVATE_SHORT_SNAPSHOT",
      },
    ],
  }));
  const events = [
    {
      type: "message.completed",
      runId: "PRIVATE_OBSERVED_CONFLICT_RUN",
      message: {
        id: "PRIVATE_LATE_EVENT_ROOT_ID",
        role: "assistant",
      },
    },
    ...Array.from({ length: 1_024 }, () => ({ type: "run.started" })),
    {
      type: "message.completed",
      runId: "PRIVATE_LATE_EVENT_RUN",
      message: {
        id: "PRIVATE_LATE_EVENT_ROOT_ID",
        role: "assistant",
      },
    },
  ];
  const view = inspectPersistedThread({
    title: "PRIVATE_BOUND_TITLE",
    threadData: JSON.stringify({
      messages: rootMessages,
      agentKit: { messages: snapshotMessages, events },
    }),
  });

  assert.equal(view.kind, "ok");
  if (view.kind !== "ok") return;
  const summary = view.assistantRelations;
  assert.equal(summary.rootMessageCount, 35);
  assert.equal(summary.rootMessagesScanned, 35);
  assert.equal(summary.rootMessagesTruncated, false);
  assert.equal(summary.rootAssistantCount, 32);
  assert.equal(summary.rootAssistantsTruncated, true);
  assert.equal(summary.snapshotMessageCount, 257);
  assert.equal(summary.snapshotMessagesScanned, 256);
  assert.equal(summary.snapshotMessagesTruncated, true);
  assert.equal(summary.snapshotAssistantCount, 256);
  assert.equal(summary.eventsCount, 1_026);
  assert.equal(summary.eventsScanned, 1_024);
  assert.equal(summary.eventsTruncated, true);
  assert.equal(summary.relations[0]?.runIdPresent, false);
  assert.equal(summary.relations[0]?.sameRunSnapshotCandidateCount, 0);
  assert.equal(summary.relations[0]?.rootContentTruncated, true);
  assert.equal(summary.relations[0]?.rootPartsTruncated, true);
  assert.equal(summary.relations[0]?.rootToolPartCount, 1_023);
  assert.equal(summary.relations[0]?.snapshotContentTruncatedCount, 0);
  assert.equal(summary.relations[0]?.exactTextMatchCount, 0);
  assert.equal(summary.relations[0]?.prefixCompatibleTextMatchCount, 0);
  assert.equal(summary.relations[1]?.runIdPresent, false);
  assert.equal(summary.relations[1]?.runIdAmbiguous, true);
  assert.equal(summary.relations[2]?.runIdPresent, false);
  assert.equal(summary.relations[2]?.runIdAmbiguous, true);

  assert.doesNotMatch(
    describePersisted(view),
    /PRIVATE_(?:ROOT|SNAPSHOT|LATE|LONG|OTHER|SHORT|BOUND)/,
  );
});

test("treats explicit run attribution as ambiguous when event conflicts may be beyond the cap", () => {
  const view = inspectPersistedThread({
    threadData: JSON.stringify({
      messages: [
        {
          message: {
            id: "root",
            role: "assistant",
            metadata: { runId: "run-one" },
            content: [{ type: "text", text: "answer" }],
          },
        },
      ],
      agentKit: {
        messages: [
          {
            id: "snapshot",
            role: "assistant",
            metadata: { runId: "run-one" },
            parts: [{ type: "text", text: "answer" }],
          },
        ],
        events: [
          ...Array.from({ length: 1024 }, () => ({ type: "run.started" })),
          {
            type: "message.completed",
            runId: "run-other",
            message: { id: "root", role: "assistant" },
          },
        ],
      },
    }),
  });
  assert.equal(view.kind, "ok");
  if (view.kind !== "ok") return;
  assert.equal(view.assistantRelations.relations[0]?.runIdAmbiguous, true);
  assert.equal(
    view.assistantRelations.relations[0]?.sameRunSnapshotCandidateCount,
    0,
  );
  assert.equal(view.assistantRelations.relations[0]?.exactTextMatchCount, 0);
});

test("an unreadable persisted thread is not mistaken for an empty one", () => {
  assert.deepEqual(inspectPersistedThread("nope"), {
    kind: "unreadable",
    reason: "response-shape",
  });
  const invalidJson = inspectPersistedThread({
    title: "PRIVATE_INVALID_JSON_TITLE",
    threadData: '{"private":"PRIVATE_PARSE_VALUE"',
  });
  assert.deepEqual(invalidJson, {
    kind: "unreadable",
    reason: "invalid-json",
  });
  assert.equal(
    describePersisted(invalidJson),
    "unreadable reason=invalid-json",
  );
  const messagesShape = inspectPersistedThread({
    title: "PRIVATE_MESSAGES_TITLE",
    threadData: JSON.stringify({ private: "PRIVATE_SHAPE_VALUE" }),
  });
  assert.deepEqual(messagesShape, {
    kind: "unreadable",
    reason: "messages-shape",
  });
  assert.equal(
    describePersisted(messagesShape),
    "unreadable reason=messages-shape",
  );
  const unreadableProperty = Object.defineProperty({}, "threadData", {
    get() {
      throw new Error("PRIVATE_UNEXPECTED_READ_FAILURE");
    },
  });
  const unknown = inspectPersistedThread(unreadableProperty);
  assert.deepEqual(unknown, { kind: "unreadable", reason: "unknown" });
  assert.equal(describePersisted(unknown), "unreadable reason=unknown");
  assert.doesNotMatch(
    [invalidJson, messagesShape, unknown].map(describePersisted).join(" "),
    /PRIVATE_/,
  );
  const settled = inspectPersistedThread({
    title: "t",
    threadData: JSON.stringify({
      messages: [
        { message: { role: "assistant", status: "complete", content: "done" } },
      ],
    }),
  });
  assert.equal(settled.kind === "ok" && settled.unsettled.length, 0);
});

test("the active-run read distinguishes idle, active, and unreadable", () => {
  assert.equal(
    inspectActiveRun({ active: false, status: "idle" }).kind,
    "idle",
  );
  assert.equal(
    inspectActiveRun({ active: true, status: "running", runId: "r" }).kind,
    "active",
  );
  assert.equal(inspectActiveRun({ error: "x" }).kind, "unreadable");
  assert.equal(inspectActiveRun(null).kind, "unreadable");
});

test("text helpers", () => {
  assert.equal(countOccurrences("a-b-a", "a"), 2);
  assert.equal(countOccurrences("abc", ""), 0);
  assert.equal(tail("  short ", 10), "short");
  assert.equal(tail("0123456789", 4), "...6789");
});

test("a prompt counts as typed only when the editor still holds its opening", () => {
  const prompt =
    "Reply with exactly ABC123 and nothing else. Do not use any tools.";
  assert.equal(
    composerHoldsPrompt(`Reply with exactly\nABC123 and nothing else.`, prompt),
    true,
  );
  assert.equal(composerHoldsPrompt("", prompt), false);
  assert.equal(composerHoldsPrompt("ply with exactly ABC123", prompt), false);
});

test("the thread id comes from the turn POST before any other request", () => {
  const entry = (overrides: Partial<TrafficEntry>): TrafficEntry => ({
    atMs: 0,
    method: "GET",
    path: "/_agent-native/agent-chat/threads",
    query: "?limit=50",
    status: 200,
    ...overrides,
  });
  assert.equal(threadIdFromTraffic([]), null);
  assert.equal(
    threadIdFromTraffic([
      entry({
        method: "POST",
        path: "/_agent-native/agent-chat",
        query: "",
        threadId: "mine",
      }),
      entry({
        path: "/_agent-native/agent-chat/threads/older-restored-thread",
        query: "",
      }),
    ]),
    "mine",
  );
  assert.equal(
    threadIdFromTraffic([
      entry({
        path: "/_agent-native/agent-chat/runs/active",
        query: "?threadId=from-poll",
      }),
    ]),
    "from-poll",
  );
});
