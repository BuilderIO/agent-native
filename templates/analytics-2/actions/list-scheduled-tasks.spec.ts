import { beforeEach, describe, expect, it, vi } from "vitest";

const definitions = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock("@agent-native/core/triggers", () => ({
  listAutomationDefinitions: async () => definitions.current,
}));

import action from "./list-scheduled-tasks";

function definition(meta: Record<string, unknown>) {
  return {
    resource: { id: "t1" },
    name: "Weekly digest",
    body: "",
    canUpdate: true,
    meta: { triggerType: "schedule", schedule: "0 9 * * 1", ...meta },
  };
}

async function listed(meta: Record<string, unknown>) {
  definitions.current = [definition(meta)];
  const rows = (await action.run({}, {
    userEmail: "a@example.com",
  } as never)) as {
    lastError: string | null;
  }[];
  return (rows[0] as { lastError: string | null }).lastError;
}

describe("list-scheduled-tasks lastError", () => {
  beforeEach(() => {
    definitions.current = [];
  });

  it("keeps the error of a run that failed", async () => {
    expect(
      await listed({
        lastStatus: "error",
        lastError: "No LLM provider is connected",
      }),
    ).toBe("No LLM provider is connected");
  });

  it("drops a stale error once a later run succeeded", async () => {
    expect(
      await listed({
        lastStatus: "success",
        lastError: "No LLM provider is connected",
      }),
    ).toBeNull();
  });
});
