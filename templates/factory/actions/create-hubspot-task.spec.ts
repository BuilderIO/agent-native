import { beforeEach, describe, expect, it, vi } from "vitest";

const requireCallerMock = vi.hoisted(() => vi.fn());
const executeMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
  defineAction: (definition: unknown) => definition,
}));
vi.mock("../server/lib/provider-api.js", () => ({
  executeProviderApiRequest: executeMock,
}));
vi.mock("../server/lib/workflow-action-support.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/workflow-action-support.js")
  >()),
  requireWorkflowActionCaller: requireCallerMock,
}));

import action from "./create-hubspot-task.js";

const caller = {
  userEmail: "owner@example.test",
  orgId: "org-1",
  factoryId: "f1",
};
const context = { caller: "automation" as const, userEmail: caller.userEmail };

beforeEach(() => {
  vi.clearAllMocks();
  requireCallerMock.mockResolvedValue(caller);
  executeMock.mockResolvedValue({
    response: { status: 201, ok: true, json: { id: "9001" } },
  });
});

describe("create-hubspot-task", () => {
  it("creates the task through the provider API substrate and returns its id", async () => {
    const result = await action.run(
      { title: "Call the lead", contactId: "42", ownerId: "77", due: "today" },
      context,
    );

    expect(result).toMatchObject({ ok: true, id: "9001", ownerId: "77" });
    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(executeMock.mock.calls[0]?.[0]).toMatchObject({
      provider: "hubspot",
      method: "POST",
      path: "/crm/v3/objects/tasks",
    });
  });

  it("treats the empty strings a graph may pass for unset fields as unset", async () => {
    await action.run(
      { title: "Call", ownerId: "", contactId: "", body: "", due: "today" },
      context,
    );

    expect(executeMock.mock.calls[0]?.[0].body).toEqual({
      properties: expect.not.objectContaining({
        hubspot_owner_id: expect.anything(),
      }),
    });
  });

  it("does not call HubSpot for a caller the gate refuses", async () => {
    requireCallerMock.mockRejectedValue(new Error("not allowed"));

    await expect(
      action.run({ title: "Call", due: "today" }, context),
    ).rejects.toThrow("not allowed");
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("keeps a task that may exist visible as unknown", async () => {
    executeMock.mockResolvedValue({ response: { status: 503, ok: false } });

    await expect(
      action.run({ title: "Call", due: "today" }, context),
    ).rejects.toMatchObject({
      errorCode: "hubspot_task_outcome_unknown",
      sideEffect: "maybe",
    });
  });

  it("declares an additive write that reaches outside", () => {
    expect(action.mcpAnnotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    });
  });
});
