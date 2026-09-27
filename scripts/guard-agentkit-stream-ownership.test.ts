import assert from "node:assert/strict";
import test from "node:test";

import {
  findLegacyChatOwnerViolations,
  findStreamOwnershipViolations,
} from "./guard-agentkit-stream-ownership.ts";

function violations(source: string): string[] {
  return findStreamOwnershipViolations("example.ts", source).map(
    (violation) => violation.reason,
  );
}

test("flags a file that reads the SSE stream and owns an AgentKit client", () => {
  const found = violations(`
import { createAgentKitClient } from "@agent-native/agentkit";
import { readSSEStream } from "../client/sse-event-processor.js";
`);

  assert.equal(found.length, 1);
  assert.match(found[0]!, /owns two readers for one stream/u);
});

test("flags the React entry too, since it builds a client of its own", () => {
  assert.equal(
    violations(`
import { AgentKitRoot } from "@agent-native/agentkit/react/root";
import { readSSEStreamRaw } from "./sse-event-processor.js";
`).length,
    1,
  );
});

test("allows a type-only AgentKit import beside the SSE reader", () => {
  assert.deepEqual(
    violations(`
import type { AgentSuggestion } from "@agent-native/agentkit/protocol";
import { readSSEStream, type ContentPart } from "../sse-event-processor.js";
`),
    [],
  );
});

test("allows an inline type specifier beside the SSE reader", () => {
  assert.deepEqual(
    violations(`
import { type AgentEvent } from "@agent-native/agentkit";
import { readSSEStream } from "./sse-event-processor.js";
`),
    [],
  );
});

test("allows the pure protocol entry beside the SSE reader", () => {
  assert.deepEqual(
    violations(`
import { parseAgentEvent } from "@agent-native/agentkit/protocol";
import { readSSEStream } from "./sse-event-processor.js";
`),
    [],
  );
});

test("allows a non-reader helper from the SSE module beside AgentKit", () => {
  assert.deepEqual(
    violations(`
import { createAgentKitClient } from "@agent-native/agentkit";
import { settleInterruptedToolCalls } from "../sse-event-processor.js";
`),
    [],
  );
});

test("flags a bare AgentKit side-effect import beside the SSE reader", () => {
  assert.equal(
    violations(`
import "@agent-native/agentkit/react/styles.css";
import { readSSEStream } from "./sse-event-processor.js";
`).length,
    1,
  );
});

test("allows either owner on its own", () => {
  assert.deepEqual(
    violations(`import { readSSEStream } from "./sse-event-processor.js";`),
    [],
  );
  assert.deepEqual(
    violations(
      `import { createAgentKitClient } from "@agent-native/agentkit";`,
    ),
    [],
  );
});

test("flags a compatibility shell that still mounts the legacy transcript", () => {
  assert.equal(
    findLegacyChatOwnerViolations(
      "packages/core/src/client/MultiTabAssistantChat.tsx",
      `import { AssistantChat } from "./AssistantChat.js";\n\nreturn <AssistantChat />;`,
    ).length,
    1,
  );
});

test("flags legacy assistant-ui chat adapters even without a mounted surface", () => {
  for (const symbol of [
    "createAgentChatAdapter",
    "createCodeAgentChatAdapter",
    "createAgentChatRuntimeAdapter",
    "codeAgentTranscriptEventsToContent",
  ]) {
    assert.equal(
      findLegacyChatOwnerViolations(
        "packages/core/src/client/chat/legacy.ts",
        `export { ${symbol} };`,
      ).length,
      1,
    );
  }
});

test("flags legacy component imports from public chat barrels", () => {
  assert.equal(
    findLegacyChatOwnerViolations(
      "templates/example/app/Layout.tsx",
      `import { AssistantChat } from "@agent-native/core/client/agent-chat";`,
    ).length,
    1,
  );
});

test("allows compatibility types and sidebar/thread shells", () => {
  assert.deepEqual(
    findLegacyChatOwnerViolations(
      "packages/core/src/client/AgentSidebar.tsx",
      `import type { AssistantChatProps } from "./AssistantChat.js";\nimport { MultiTabAssistantChat } from "./MultiTabAssistantChat.js";\nreturn <MultiTabAssistantChat />;`,
    ),
    [],
  );
});

test("flags an exported legacy transcript controller even without callers", () => {
  assert.equal(
    findLegacyChatOwnerViolations(
      "packages/core/src/client/AssistantChat.tsx",
      `export const AssistantChat = forwardRef(() => null);`,
    ).length,
    1,
  );
});

test("flags legacy assistant-ui transcript primitives outside shared composer", () => {
  assert.equal(
    findLegacyChatOwnerViolations(
      "packages/core/src/client/chat/message-components.tsx",
      `import { MessagePrimitive } from "@assistant-ui/react";`,
    ).length,
    1,
  );
});

test("allows assistant-ui composer primitives in the shared composer", () => {
  assert.deepEqual(
    findLegacyChatOwnerViolations(
      "packages/toolkit/src/composer/AgentComposerFrame.tsx",
      `import { ComposerPrimitive, useComposer } from "@assistant-ui/react";`,
    ),
    [],
  );
});
