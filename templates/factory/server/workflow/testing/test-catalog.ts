import {
  createOperationRegistry,
  type OperationCatalog,
} from "../operations.js";

/**
 * A small catalog the engine specs run against, so they do not move when the
 * real catalog's operations do. `test.read` is a lookup, `test.write` a write
 * with a receipt, `test.items` a source with a cursor, `test.window` a source
 * over a window, and `builder.*` the three agent operations.
 */
export function buildTestCatalog(): OperationCatalog {
  const registry = createOperationRegistry();
  const mapping = {
    kind: "message",
    fields: { title: "title", occurredAt: "at" },
    dedupeKey: "id",
  } as const;

  registry.register({
    id: "test.read",
    provider: "test",
    label: "Test: read",
    nodeKinds: ["lookup"],
    effect: "read",
    fields: [{ name: "key", type: "string", required: true }],
    implementation: { type: "action", action: "test-read" },
    credential: { provider: "test" },
  });
  registry.register({
    id: "test.typed",
    provider: "test",
    label: "Test: typed read",
    nodeKinds: ["lookup"],
    effect: "read",
    fields: [
      { name: "count", type: "number" },
      { name: "flag", type: "boolean" },
      { name: "level", type: "enum", enum: ["low", "high"] },
      { name: "extra", type: "json" },
      { name: "note", type: "text", default: "fallback" },
    ],
    implementation: { type: "action", action: "test-typed" },
    credential: { provider: "test" },
  });
  registry.register({
    id: "test.write",
    provider: "test",
    label: "Test: write",
    nodeKinds: ["action"],
    effect: "write",
    fields: [
      { name: "text", type: "text", required: true },
      { name: "to", type: "string" },
    ],
    implementation: { type: "action", action: "test-write" },
    receipt: { externalRef: "id", url: "link" },
    credential: { provider: "test" },
  });
  registry.register({
    id: "test.items",
    provider: "test",
    label: "Test: items with a cursor",
    nodeKinds: ["source"],
    effect: "read",
    fields: [{ name: "query", type: "string" }],
    implementation: {
      type: "provider-request",
      method: "GET",
      pathTemplate: "/items",
    },
    cursor: { param: "after", path: "next" },
    itemMapping: mapping,
    credential: { provider: "test" },
  });
  registry.register({
    id: "test.window",
    provider: "test",
    label: "Test: items in a window",
    nodeKinds: ["source"],
    effect: "read",
    fields: [],
    implementation: {
      type: "provider-request",
      method: "GET",
      pathTemplate: "/window",
    },
    window: { fromParam: "since", toParam: "until" },
    itemMapping: mapping,
    credential: { provider: "test" },
  });
  const task = [
    { name: "projectId", type: "string", required: true },
    { name: "branchName", type: "string", required: true },
  ] as const;
  registry.register({
    id: "builder.start",
    provider: "builder",
    label: "Builder: start",
    nodeKinds: ["agent"],
    effect: "write",
    fields: [...task, { name: "prompt", type: "text", required: true }],
    implementation: { type: "builder", op: "start" },
    receipt: { externalRef: "branchName", url: "url" },
    credential: { provider: "builder" },
  });
  registry.register({
    id: "builder.check",
    provider: "builder",
    label: "Builder: check",
    nodeKinds: ["agent"],
    effect: "read",
    fields: [...task],
    implementation: { type: "builder", op: "check" },
    credential: { provider: "builder" },
  });
  registry.register({
    id: "builder.followUp",
    provider: "builder",
    label: "Builder: follow up",
    nodeKinds: ["agent"],
    effect: "write",
    fields: [...task, { name: "userMessage", type: "text", required: true }],
    implementation: { type: "builder", op: "followUp" },
    receipt: { externalRef: "branchName" },
    credential: { provider: "builder" },
  });
  return { get: (id) => registry.get(id) };
}
