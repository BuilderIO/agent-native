import assert from "node:assert/strict";
import test from "node:test";

import {
  CHAT_SEND_GATE_WHOLE_FILE_BOUNDARIES,
  findChatSendGateViolations,
} from "./guard-chat-send-gate.ts";

function violations(file: string, source: string) {
  return findChatSendGateViolations(file, source).map(({ reason }) => reason);
}

test("flags raw prompt POSTs outside the shared dispatch boundary", () => {
  assert.deepEqual(
    violations(
      "templates/example/Chat.tsx",
      `fetch(agentNativePath("/_agent-native/agent-chat"), {
  method: "POST",
  body: JSON.stringify({ message }),
});`,
    ),
    [
      "prompt POST must use an approved shared dispatch boundary instead of raw fetch",
    ],
  );
});

test("allows a reviewed opt-out only when the pragma includes a reason", () => {
  assert.deepEqual(
    violations(
      "templates/example/Chat.tsx",
      `// guard:allow-chat-send-gate - this host submits to a non-agent endpoint
fetch("/_agent-native/agent-chat", { method: "POST", body: "{}" });`,
    ),
    [],
  );
  assert.deepEqual(
    violations(
      "templates/example/Chat.tsx",
      `// guard:allow-chat-send-gate
fetch("/_agent-native/agent-chat", { method: "POST", body: "{}" });`,
    ),
    [
      "prompt POST must use an approved shared dispatch boundary instead of raw fetch",
    ],
  );
});

test("recognizes route and request options stored in constants", () => {
  const [reason] = violations(
    "templates/example/send.ts",
    `const endpoint = "/_agent-native/agent-chat";
const requestOptions = { method: "POST", body: JSON.stringify({ message }) };
fetch(endpoint, requestOptions);`,
  );

  assert.match(reason ?? "", /approved shared dispatch boundary/u);
});

test("recognizes aliased fetches and request helpers that hide the fetch call", () => {
  const source = `const CHAT_PATH = "/_agent-native/agent-chat";
const endpoint = \`\${CHAT_PATH}?surface=template\`;
const rawFetch = fetch;
rawFetch(endpoint, { method: "POST", body: "{}" });
jsonRequest(CHAT_PATH, { method: "POST", body: "{}" });
http.post(CHAT_PATH, { message: "hello" });
axios({ url: CHAT_PATH, method: "POST", data: { message: "hello" } });
submitChat(CHAT_PATH);
fetchAgentChat(CHAT_PATH);`;

  assert.deepEqual(violations("templates/example/Chat.ts", source), [
    "prompt POST must use an approved shared dispatch boundary instead of raw fetch",
    "prompt POST must use an approved shared dispatch boundary instead of raw fetch",
    "prompt POST must use an approved shared dispatch boundary instead of raw fetch",
    "prompt POST must use an approved shared dispatch boundary instead of raw fetch",
    "prompt POST must use an approved shared dispatch boundary instead of raw fetch",
    "prompt POST must use an approved shared dispatch boundary instead of raw fetch",
  ]);
});

test("does not confuse history, status, or GET requests with prompt sends", () => {
  assert.deepEqual(
    violations(
      "packages/core/src/client/agent-engine-readiness.ts",
      `fetch("/_agent-native/agent-chat/threads/thread-1", { method: "GET" });
fetch("/_agent-native/agent-engine/status", { method: "GET" });
fetch("/_agent-native/agent-chat", { method: "GET" });`,
    ),
    [],
  );
});

test("does not mistake a POST to a child thread operation for a prompt send", () => {
  assert.deepEqual(
    violations(
      "packages/mobile-app/lib/agent-chat/api.ts",
      `const CHAT_PATH = "/_agent-native/agent-chat";
jsonRequest(\`\${CHAT_PATH}/threads/thread-1/fork\`, { method: "POST", body: {} });`,
    ),
    [],
  );
});

test("requires readiness even for raw POSTs in shared dispatch modules", () => {
  const send = `fetch("/_agent-native/agent-chat", {
  method: "POST",
  body: JSON.stringify({ message }),
});`;

  assert.match(
    violations(
      "packages/core/src/client/chat/agentkit-agent-native.ts",
      send,
    )[0] ?? "",
    /pass readiness before sending/u,
  );
  assert.match(
    violations("packages/core/src/client/chat/runtime.ts", send)[0] ?? "",
    /pass readiness before sending/u,
  );
  assert.deepEqual(
    violations(
      "packages/core/src/client/chat/agentkit-agent-native.ts",
      `const transport = {
  assertAiSetupReady: () => requireAgentEngineConfiguredForDispatch(),
  beforeStartTurn: () => requireAgentEngineConfiguredForDispatch(),
};
async function start() {
  await requireAgentEngineConfiguredForDispatch();
  ${send}
}`,
    ),
    [],
  );
  assert.deepEqual(
    violations(
      "packages/core/src/client/chat/runtime.ts",
      `const startTurn = async () => {
  await options.beforeStartTurn?.({ session: summary, turn });
  await fetchImpl(endpoint, { method: "POST" });
};
const runtimeOptions = {
  beforeStartTurn: () => requireAgentEngineConfiguredForDispatch(),
};
async function start() {
  await requireAgentEngineConfiguredForDispatch();
  ${send}
}`,
    ),
    [],
  );
});

test("requires the background-session dispatch function to invoke the shared readiness gate first", () => {
  const file = "packages/core/src/client/background-agent-session.ts";
  assert.ok(CHAT_SEND_GATE_WHOLE_FILE_BOUNDARIES.includes(file));
  assert.match(
    violations(
      file,
      `function start() {
  fetch("/_agent-native/agent-chat", { method: "POST", body: "{}" });
}`,
    )[0] ?? "",
    /pass readiness before sending/u,
  );

  assert.deepEqual(
    violations(
      file,
      `async function start() {
  await requireAgentEngineConfiguredForDispatch();
  fetch("/_agent-native/agent-chat", { method: "POST", body: "{}" });
}`,
    ),
    [],
  );
});

test("rejects readiness opt-outs on components and helper calls", () => {
  assert.deepEqual(
    violations(
      "templates/example/Chat.tsx",
      `function Chat() {
  useAgentEngineConfigured(false);
  return <AgentKitAssistantChat providerStatusChecksEnabled={false} />;
}`,
    ),
    [
      "readiness checks may not be disabled at a dispatch surface",
      "provider readiness bypass props may not be set to false",
    ],
  );
});

test("rejects object-configured readiness bypasses without reading source files", () => {
  assert.deepEqual(
    violations(
      "packages/toolkit/src/chat-options.ts",
      `const chatOptions = {
  requireAgentEngine: false,
  modelStatusChecksEnabled: false,
};`,
    ),
    [
      "provider readiness bypass props may not be set to false",
      "provider readiness bypass props may not be set to false",
    ],
  );
});

test("does not flag normal controller send API calls", () => {
  assert.deepEqual(
    violations(
      "templates/example/Chat.tsx",
      `await controller.sendMessage({ threadId, text });`,
    ),
    [],
  );
});

test("gates new sends and queue appends while constraining Continue to an admitted run", () => {
  const file = "packages/agentkit/src/client/client.ts";
  const gated = `class AgentKitClient {
  async assertAiSetupReady() {
    const assertReady = this.transport.assertAiSetupReady;
    if (!assertReady) throw new Error("missing readiness callback");
    await this.invokeRequest({}, (context) => assertReady({}, context));
  }
  async sendMessage() {
    await this.assertAiSetupReady();
    this.setThread();
    this.transport.startRun();
  }
  async queueMessage() {
    await this.assertAiSetupReady();
    this.setThread();
    this.transport.queueMessage();
  }
  async continueRun(threadId: string, runId: string) {
    this.transport.continueRun({ threadId, runId });
  }
}`;
  assert.deepEqual(violations(file, gated), []);

  const explicitOptOut = gated.replace(
    'if (!assertReady) throw new Error("missing readiness callback");',
    `if (!assertReady) {
      if (this.aiSetupReadiness === "not-applicable") return;
      throw new Error("missing readiness callback");
    }`,
  );
  assert.deepEqual(violations(file, explicitOptOut), []);

  const ungated = gated.replaceAll(
    "    await this.assertAiSetupReady();\n",
    "",
  );
  assert.deepEqual(violations(file, ungated), [
    "AgentKitClient.sendMessage must await assertAiSetupReady before setThread",
    "AgentKitClient.queueMessage must await assertAiSetupReady before setThread",
  ]);

  const promptContinuation = gated.replace(
    `async continueRun(threadId: string, runId: string) {
    this.transport.continueRun({ threadId, runId });
  }`,
    `async continueRun(threadId: string, prompt: string) {
    this.transport.continueRun({ threadId, prompt });
  }`,
  );
  assert.deepEqual(violations(file, promptContinuation), [
    "AgentKitClient.continueRun may only resume a server-admitted thread and run id",
  ]);

  const silentFallback = gated.replace(
    'if (!assertReady) throw new Error("missing readiness callback");',
    "if (!assertReady) return;",
  );
  assert.deepEqual(violations(file, silentFallback), [
    "AgentKitClient.assertAiSetupReady may not return successfully when its transport readiness callback is absent",
  ]);
});

test("requires the HTTP runtime start hook before its fetch and the framework adapter to wire both gates", () => {
  assert.deepEqual(
    violations(
      "packages/core/src/client/chat/runtime.ts",
      `const startTurn = async () => {
  await options.beforeStartTurn?.({ session: summary, turn });
  await fetchImpl(endpoint, { method: "POST" });
};
const runtimeOptions = {
  beforeStartTurn: () => requireAgentEngineConfiguredForDispatch(),
};`,
    ),
    [],
  );
  assert.match(
    violations(
      "packages/core/src/client/chat/runtime.ts",
      `const startTurn = async () => {
  await fetchImpl(endpoint, { method: "POST" });
};
const runtimeOptions = {
  beforeStartTurn: () => requireAgentEngineConfiguredForDispatch(),
};`,
    )[0] ?? "",
    /await beforeStartTurn before its fetch dispatch/u,
  );

  const file = "packages/core/src/client/chat/agentkit-agent-native.ts";
  const controller = `class AgentKitClient {
  async assertAiSetupReady() {
    const assertReady = this.transport.assertAiSetupReady;
    if (!assertReady) throw new Error("missing readiness callback");
    await assertReady();
  }
}`;
  assert.deepEqual(
    violations(
      file,
      `${controller}
const transport = {
  assertAiSetupReady: () => requireAgentEngineConfiguredForDispatch(),
  beforeStartTurn: () => requireAgentEngineConfiguredForDispatch(),
};`,
    ),
    [],
  );
  assert.deepEqual(violations(file, `${controller}\nconst transport = {};`), [
    "Agent-Native controller transport must wire assertAiSetupReady to the shared readiness gate",
  ]);
});

test("keeps readiness probes and raw status paths inside the shared modules", () => {
  assert.deepEqual(
    violations("templates/example/Chat.tsx", `useAgentEngineConfigured();`),
    [],
  );
  assert.deepEqual(
    violations(
      "templates/example/Chat.tsx",
      `fetchAgentEngineConfiguredState();`,
    ),
    ["readiness probes must stay behind the shared readiness module and hook"],
  );
  assert.deepEqual(
    violations(
      "templates/example/Chat.tsx",
      `fetchAgentEngineStatus({ fresh: true });`,
    ),
    [
      "agent-engine status reads must use the shared status helper or readiness hook",
    ],
  );
  assert.deepEqual(
    violations(
      "packages/core/src/client/analytics.ts",
      `fetchAgentEngineStatus();`,
    ),
    [],
  );
  assert.deepEqual(
    violations(
      "templates/example/Chat.tsx",
      `fetch("/_agent-native/agent-engine/status");`,
    ),
    [
      "agent-engine readiness status reads must use the shared readiness/status helper",
    ],
  );
});
