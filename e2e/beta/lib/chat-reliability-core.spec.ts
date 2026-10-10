import assert from "node:assert/strict";
import test from "node:test";

import {
  checkTranscript,
  composerHoldsPrompt,
  countOccurrences,
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

test("an unreadable persisted thread is not mistaken for an empty one", () => {
  assert.equal(inspectPersistedThread("nope").kind, "unreadable");
  assert.equal(
    inspectPersistedThread({ title: "t", threadData: "{" }).kind,
    "unreadable",
  );
  assert.equal(
    inspectPersistedThread({ title: "t", threadData: "{}" }).kind,
    "unreadable",
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
