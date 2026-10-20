import { describe, expect, it } from "vitest";

import * as workflow from "./index.js";

describe("the workflow barrel", () => {
  it("exposes the contract, grammar, validation, operations, items and ports", () => {
    expect(Object.keys(workflow)).toEqual(
      expect.arrayContaining([
        "NODE_KINDS",
        "workflowGraphSchema",
        "workflowNodeSchema",
        "workflowEdgeSchema",
        "fieldBindingSchema",
        "ruleSchema",
        "receiptSchema",
        "receiptKey",
        "itemEventSchema",
        "stepRecordSchema",
        "itemStateSchema",
        "WORKFLOW_ERROR_CODES",
        "WorkflowError",
        "nodeScopeKey",
        "portsFor",
        "portsWithLimit",
        "parseTemplate",
        "validatePath",
        "evaluatePath",
        "renderTemplate",
        "collectPaths",
        "ExpressionError",
        "validateWorkflowGraph",
        "ISSUE_CODES",
        "operationDefinitionSchema",
        "createOperationRegistry",
        "buildOperationCatalog",
        "OPERATION_CATALOG",
        "isWriteAllowedForNode",
        "normalizedItemSchema",
        "boundItem",
        "assertWithinStepCap",
        "MAX_INLINE_ITEMS",
        "MAX_STEP_OUTPUT_BYTES",
        "MAX_ITEM_CONTEXT_BYTES",
      ]),
    );
  });

  it("exposes the engine: running a tick, and what a resume pass will build on", () => {
    expect(Object.keys(workflow)).toEqual(
      expect.arrayContaining([
        "runTick",
        "walkGraph",
        "planGraph",
        "executorFor",
        "NODE_EXECUTORS",
        "ItemRuntime",
        "createRunBudget",
        "computeRunWindow",
        "MAX_ITEM_ATTEMPTS",
        "loopsOf",
        "prepareResume",
      ]),
    );
  });

  it("validates a graph end to end using only the barrel", () => {
    const registry = workflow.createOperationRegistry();
    registry.register({
      id: "slack.postMessage",
      provider: "slack",
      label: "Slack: post a message",
      nodeKinds: ["action"],
      effect: "write",
      fields: [{ name: "text", type: "text", required: true }],
      implementation: { type: "action", action: "slack-post-message" },
      credential: { provider: "slack" },
    });
    const graph = workflow.workflowGraphSchema.parse({
      nodes: [
        {
          id: "start",
          name: "start",
          kind: "trigger",
          position: { x: 0, y: 0 },
          settings: { schedule: { daily: { at: "08:00" } } },
        },
        {
          id: "send",
          name: "send",
          kind: "action",
          position: { x: 200, y: 0 },
          settings: {
            operation: "slack.postMessage",
            args: { text: { mode: "fixed", value: "Good morning" } },
          },
        },
        {
          id: "finish",
          name: "finish",
          kind: "end",
          position: { x: 400, y: 0 },
          settings: { outcome: "done" },
        },
      ],
      edges: [
        {
          id: "e1",
          from: { node: "start", port: "out" },
          to: { node: "send" },
        },
        {
          id: "e2",
          from: { node: "send", port: "out" },
          to: { node: "finish" },
        },
      ],
      settings: {},
    });
    expect(workflow.validateWorkflowGraph(graph, registry)).toEqual({
      ok: true,
      issues: [],
    });
  });
});
