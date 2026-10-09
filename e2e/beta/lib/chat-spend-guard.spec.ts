import assert from "node:assert/strict";
import test from "node:test";

import {
  LUNA_OPENAI_MODEL,
  MISSING_ENGINE,
  formatChatRequestDiagnostics,
  readTurnSelection,
  spendViolations,
  watchAgentNativeRequests,
  watchChatRequests,
  type ChatRequestLog,
} from "./chat";

const OPENAI = "ai-sdk:openai";
const LUNA = LUNA_OPENAI_MODEL;

function eventPage(pageUrl: string) {
  type Listener = (value: unknown) => void;
  const listeners = new Map<string, Set<Listener>>();
  let currentUrl = pageUrl;
  const page = {
    url: () => currentUrl,
    on: (event: string, listener: Listener) => {
      const handlers = listeners.get(event) ?? new Set<Listener>();
      handlers.add(listener);
      listeners.set(event, handlers);
    },
    off: (event: string, listener: Listener) => {
      listeners.get(event)?.delete(listener);
    },
  } as unknown as Parameters<typeof watchAgentNativeRequests>[0];

  return {
    page,
    setUrl(url: string) {
      currentUrl = url;
    },
    emit(event: string, value: unknown) {
      for (const listener of listeners.get(event) ?? []) listener(value);
    },
    listenerCount() {
      return [...listeners.values()].reduce(
        (total, handlers) => total + handlers.size,
        0,
      );
    },
  };
}

function request(url: string, method = "GET") {
  return {
    url: () => url,
    method: () => method,
    postData: () => {
      throw new Error("request body must not be read");
    },
    headers: () => {
      throw new Error("request headers must not be read");
    },
  };
}

function log(
  requests: Array<{ model: string | null; engine: string | null }>,
): ChatRequestLog {
  return {
    models: requests.flatMap((r) => (r.model ? [r.model] : [])),
    engines: requests.map((r) => r.engine ?? MISSING_ENGINE),
    modelless: requests.filter((r) => !r.model).length,
    count: requests.length,
    requests,
  };
}

test("reads only what a turn body names at the top level", () => {
  assert.deepEqual(
    readTurnSelection(JSON.stringify({ model: LUNA, engine: OPENAI })),
    { model: LUNA, engine: OPENAI },
  );
  // Metadata alone is not evidence; only the top-level request field counts.
  assert.deepEqual(
    readTurnSelection(
      JSON.stringify({ model: LUNA, metadata: { engine: OPENAI } }),
    ),
    { model: LUNA, engine: null },
  );
  assert.deepEqual(readTurnSelection(JSON.stringify({ model: "  " })), {
    model: null,
    engine: null,
  });
  assert.deepEqual(readTurnSelection("not json"), {
    model: null,
    engine: null,
  });
  assert.deepEqual(readTurnSelection(null), { model: null, engine: null });
});

test("pre-navigation chat diagnostics allowlist routes and strip URL secrets", () => {
  const events = eventPage("about:blank");
  const chat = watchChatRequests(events.page);
  assert.equal(events.listenerCount(), 7);
  events.setUrl("https://beta.content.agent-native.com/?page-secret");

  const readiness = request(
    "https://beta.content.agent-native.com/_agent-native/agent-engine/status?token=query-secret",
  );
  events.emit("request", readiness);
  events.emit("response", { request: () => readiness, status: () => 200 });
  const appState = request(
    "https://beta.content.agent-native.com/_agent-native/application-state/pending-selection-context?key=short-secret",
  );
  events.emit("request", appState);
  events.emit("response", { request: () => appState, status: () => 204 });
  events.emit("requestfinished", appState);

  const history = request(
    "https://beta.content.agent-native.com/_agent-native/agent-chat/threads/thread-id-secret?search=history-secret",
  );
  events.emit("request", history);
  events.emit("response", { request: () => history, status: () => 200 });
  events.emit("requestfinished", history);

  const document = request(
    "https://beta.content.agent-native.com/_agent-native/actions/get-document?documentId=document-secret",
  );
  events.emit("request", document);
  events.emit("response", { request: () => document, status: () => 404 });
  events.emit("requestfinished", document);

  const unknown = request(
    "https://beta.content.agent-native.com/_agent-native/x?token=unknown-secret",
  );
  events.emit("request", unknown);
  events.emit("requestfinished", unknown);

  const formatted = formatChatRequestDiagnostics(chat.log);
  const log = JSON.parse(formatted.slice("Agent chat requests: ".length)) as {
    agentNativeRequests: {
      requests: Array<{
        path: string;
        status: number | null;
        pending: boolean;
      }>;
    };
  };
  assert.deepEqual(
    log.agentNativeRequests.requests.map(({ path, status, pending }) => [
      path,
      status,
      pending,
    ]),
    [
      ["/_agent-native/agent-engine/status", 200, true],
      [
        "/_agent-native/application-state/pending-selection-context",
        204,
        false,
      ],
      ["/_agent-native/agent-chat/threads/:id", 200, false],
      ["/_agent-native/actions/get-document", 404, false],
      ["/_agent-native/[redacted]", null, false],
    ],
  );
  assert.doesNotMatch(
    formatted,
    /page-secret|query-secret|short-secret|thread-id-secret|history-secret|document-secret|unknown-secret|\?/,
  );
  chat.dispose();
  assert.equal(events.listenerCount(), 0);
});

test("the bounded ring retains pending readiness ahead of completed polls", () => {
  let now = 10;
  const { page, emit } = eventPage("https://beta.content.agent-native.com/");
  const diagnostics = watchAgentNativeRequests(page, () => now);

  const readiness = request(
    "https://beta.content.agent-native.com/_agent-native/agent-engine/status?secret=query",
  );
  emit("request", readiness);
  emit("response", { request: () => readiness, status: () => 202 });

  for (let index = 0; index < 24; index += 1) {
    const poll = request(
      "https://beta.content.agent-native.com/_agent-native/application-state?keys=" +
        index,
    );
    emit("request", poll);
    emit("response", { request: () => poll, status: () => 200 });
    emit("requestfinished", poll);
    now += 5;
  }

  const snapshot = diagnostics.snapshot();
  assert.equal(snapshot.requests.length, 24);
  assert.equal(snapshot.omittedRequests, 1);
  assert.deepEqual(snapshot.requests[0], {
    path: "/_agent-native/agent-engine/status",
    method: "GET",
    status: 202,
    pending: true,
    elapsedMs: 120,
  });
  assert.deepEqual(snapshot.requests.at(-1), {
    path: "/_agent-native/application-state",
    method: "GET",
    status: 200,
    pending: false,
    elapsedMs: 0,
  });
  diagnostics.dispose();
});

test("URL diagnostics redact unknown routes and omit excess all-pending requests", () => {
  let now = 10;
  const { page, emit } = eventPage("https://beta.content.agent-native.com/");
  const diagnostics = watchAgentNativeRequests(page, () => now);

  emit(
    "request",
    request(
      "https://other.example.test/_agent-native/agent-chat?token=cross-origin-secret",
      "POST",
    ),
  );
  for (let index = 0; index < 25; index += 1) {
    emit(
      "request",
      request(
        "https://beta.content.agent-native.com/_agent-native/x" +
          index +
          "?token=short-secret",
        index === 0 ? "TRACE" : "GET",
      ),
    );
    now += 15;
  }
  now += 999_999;

  const snapshot = diagnostics.snapshot();
  assert.equal(snapshot.requests.length, 24);
  assert.equal(snapshot.omittedRequests, 1);
  assert.ok(snapshot.requests.every((entry) => entry.pending));
  assert.ok(snapshot.requests.every((entry) => entry.elapsedMs === 300_000));
  assert.equal(snapshot.requests[0]?.method, "OTHER");
  assert.ok(
    snapshot.requests.every(
      (entry) => entry.path === "/_agent-native/[redacted]",
    ),
  );
  assert.doesNotMatch(
    JSON.stringify(diagnostics.snapshot()),
    /other\.example\.test|cross-origin-secret|short-secret|\bx\d+\b|\?/,
  );
  diagnostics.dispose();
});

test("disposing request diagnostics detaches listeners and ignores late events", () => {
  const events = eventPage("https://beta.content.agent-native.com/");
  const diagnostics = watchAgentNativeRequests(events.page, () => 10);
  const pending = request(
    "https://beta.content.agent-native.com/_agent-native/actions/get-document?id=private",
  );
  events.emit("request", pending);
  const beforeDispose = diagnostics.snapshot();

  assert.equal(events.listenerCount(), 5);
  diagnostics.dispose();
  assert.equal(events.listenerCount(), 0);
  events.emit("response", { request: () => pending, status: () => 200 });
  events.emit("requestfinished", pending);
  events.emit(
    "request",
    request("https://beta.content.agent-native.com/_agent-native/agent-chat"),
  );
  assert.deepEqual(diagnostics.snapshot(), beforeDispose);

  const closingPage = eventPage("https://beta.content.agent-native.com/");
  watchAgentNativeRequests(closingPage.page);
  closingPage.emit("close", undefined);
  assert.equal(closingPage.listenerCount(), 0);
});

test("a turn that names luna and the expected engine is clean", () => {
  assert.deepEqual(
    spendViolations(log([{ model: LUNA, engine: OPENAI }]), {
      engine: OPENAI,
    }),
    [],
  );
});

test("a turn that names no engine is a violation, because the server picks the engine", () => {
  const lines = spendViolations(log([{ model: LUNA, engine: null }]), {
    engine: OPENAI,
  });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /1 request\(s\) named no engine/);
  assert.match(lines[0], /did not provably bill the dedicated key/);
});

test("a turn that names no model is a violation", () => {
  assert.match(
    spendViolations(log([{ model: null, engine: OPENAI }]), {
      engine: OPENAI,
    }).join("\n"),
    /1 request\(s\) carried no model field/,
  );
});

test("a non-luna model is a violation", () => {
  assert.match(
    spendViolations(log([{ model: "claude-opus-4-8", engine: OPENAI }]), {
      engine: OPENAI,
    }).join("\n"),
    /non-luna models: claude-opus-4-8/,
  );
});

test("a turn that names a different engine is a violation", () => {
  assert.match(
    spendViolations(log([{ model: LUNA, engine: "builder" }]), {
      engine: OPENAI,
    }).join("\n"),
    /routed through engine\(s\) builder instead of ai-sdk:openai/,
  );
});

test("one unprovable turn among clean ones still fails the run", () => {
  const lines = spendViolations(
    log([
      { model: LUNA, engine: OPENAI },
      { model: LUNA, engine: null },
      { model: LUNA, engine: OPENAI },
    ]),
    { engine: OPENAI },
  );
  assert.equal(lines.length, 1);
  assert.match(lines[0], /1 request\(s\) named no engine/);
});
