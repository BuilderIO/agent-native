import assert from "node:assert/strict";
import test from "node:test";

import { findStreamOwnershipViolations } from "./guard-agentkit-stream-ownership.ts";

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
  // packages/core/src/client/chat/runtime.ts is exactly this shape: it shares
  // AgentKit's types but creates no second reader.
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
