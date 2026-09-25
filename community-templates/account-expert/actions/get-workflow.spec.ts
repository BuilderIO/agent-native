import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  state: new Map<string, Record<string, unknown>>(),
  readAppState: vi.fn(),
  writeAppState: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: mocks.readAppState,
  writeAppState: mocks.writeAppState,
}));

import { workflow } from "../app/lib/workflow.js";
import action from "./get-workflow.js";

describe("get-workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.clear();
    mocks.readAppState.mockImplementation(async (key: string) => {
      return mocks.state.get(key) ?? null;
    });
    mocks.writeAppState.mockImplementation(
      async (key: string, value: Record<string, unknown>) => {
        mocks.state.set(key, value);
      },
    );
  });

  it("does not claim unscoped legacy workflow or selection state", async () => {
    mocks.state.set(
      "workflow-data",
      structuredClone(workflow) as unknown as Record<string, unknown>,
    );
    mocks.state.set("workflow-selection", {
      selectedId: workflow.items[1].id,
    });

    const result = await action.run({});

    expect(result).toEqual({
      workflow,
      selectedId: workflow.items[0].id,
    });
    expect(mocks.state.get("workflow-data")).toEqual(workflow);
    expect(mocks.state.get("workflow-selection")).toEqual({
      selectedId: workflow.items[1].id,
    });
    expect(mocks.state.get("account-expert:workflow-data")).toEqual(workflow);
    expect(mocks.readAppState).not.toHaveBeenCalledWith("workflow-data");
    expect(mocks.readAppState).not.toHaveBeenCalledWith("workflow-selection");
  });

  it("reads workflow and selection state from this app's keys", async () => {
    const storedWorkflow = structuredClone(workflow);
    storedWorkflow.items[0].status = "In progress";
    mocks.state.set(
      "account-expert:workflow-data",
      storedWorkflow as unknown as Record<string, unknown>,
    );
    mocks.state.set("account-expert:workflow-selection", {
      selectedId: workflow.items[1].id,
    });

    const result = await action.run({});

    expect(result).toEqual({
      workflow: storedWorkflow,
      selectedId: workflow.items[1].id,
    });
  });
});
