import { beforeEach, expect, it, vi } from "vitest";

const keyPolicy = vi.hoisted(() => ({
  resolve: vi.fn(),
  allowlist: vi.fn(),
}));

vi.mock("../secrets/substitution.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../secrets/substitution.js")>()),
  resolveKeyReferencesWithRequestScopes: keyPolicy.resolve,
  getResolvedKeyAllowlist: keyPolicy.allowlist,
}));

import {
  createAutomationRuntime,
  type AutomationWorkflowDefinition,
} from "./index.js";

const workflow: AutomationWorkflowDefinition = {
  id: "saved-workflow",
  connectorId: "n8n",
  name: "Saved workflow",
  inputSchema: { type: "object" },
  response: { mode: "synchronous" },
  capabilities: {
    invokesExternalWorkflow: true,
    receivesCallback: false,
    supportsIdempotency: false,
    supportsSynchronousResponse: true,
    supportsAsynchronousResponse: false,
    mayCauseExternalSideEffects: false,
  },
  outbound: {
    baseUrl: "https://workflow.example.test",
    path: "/invoke",
    headers: { Authorization: "Bearer ${keys.WORKFLOW_KEY}" },
  },
};

beforeEach(() => {
  keyPolicy.resolve.mockReset().mockResolvedValue({
    resolved: "Bearer fake-value",
    usedKeys: ["WORKFLOW_KEY"],
    secretValues: ["fake-value"],
    resolvedKeys: [
      { name: "WORKFLOW_KEY", scope: "user", scopeId: "owner@example.test" },
    ],
  });
  keyPolicy.allowlist.mockReset();
});

it("sends a resolved key only to its approved workflow origin", async () => {
  keyPolicy.allowlist.mockResolvedValue(["https://workflow.example.test"]);
  const fetch = vi.fn().mockResolvedValue(
    new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  const runtime = createAutomationRuntime({ workflows: [workflow], fetch });

  await runtime.invoke({
    workflowId: workflow.id,
    userEmail: "owner@example.test",
    input: {},
  });

  expect(keyPolicy.allowlist).toHaveBeenCalledWith({
    name: "WORKFLOW_KEY",
    scope: "user",
    scopeId: "owner@example.test",
  });
  expect(fetch).toHaveBeenCalledOnce();
});

it("refuses a workflow origin absent from the resolved key policy", async () => {
  keyPolicy.allowlist.mockResolvedValue(["https://api.example.test"]);
  const fetch = vi.fn();
  const runtime = createAutomationRuntime({ workflows: [workflow], fetch });

  await expect(
    runtime.invoke({
      workflowId: workflow.id,
      userEmail: "owner@example.test",
      input: {},
    }),
  ).rejects.toMatchObject({ code: "blocked_target" });
  expect(fetch).not.toHaveBeenCalled();
});
