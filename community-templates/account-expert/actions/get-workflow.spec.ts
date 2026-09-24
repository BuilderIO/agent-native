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

  it("migrates existing workflow and selection state to app-specific keys", async () => {
    const storedWorkflow = structuredClone(workflow);
    const selectedId = workflow.items[1].id;
    mocks.state.set(
      "workflow-data",
      storedWorkflow as unknown as Record<string, unknown>,
    );
    mocks.state.set("workflow-selection", { selectedId });

    const result = await action.run({});

    expect(result).toEqual({ workflow: storedWorkflow, selectedId });
    expect(mocks.state.get("account-expert:workflow-data")).toEqual(
      storedWorkflow,
    );
    expect(mocks.state.get("account-expert:workflow-selection")).toEqual({
      selectedId,
    });
  });
});
