import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineAction } from "../action.js";
import {
  AgentNavigationRefusedError,
  assertNavigateWriteAllowed,
} from "./navigate-write-guard.js";

function inAction<T>(
  caller: "mcp" | "tool" | "a2a" | "frontend" | "cli",
  readOnly: boolean,
  fn: () => T | Promise<T>,
): Promise<T> {
  const action = defineAction({
    description: "Run a check inside an action.",
    schema: z.object({}),
    readOnly,
    run: async () => fn(),
  });
  return action.run({}, { caller }) as Promise<T>;
}

describe("assertNavigateWriteAllowed", () => {
  it.each([
    ["mcp", "navigate"],
    ["tool", "navigate:tab-1"],
    ["a2a", "navigate"],
  ] as const)("refuses a %s read writing %s", async (caller, key) => {
    const refusal = inAction(caller, true, () =>
      assertNavigateWriteAllowed(key),
    );
    await expect(refusal).rejects.toBeInstanceOf(AgentNavigationRefusedError);
    await expect(
      inAction(caller, true, () => assertNavigateWriteAllowed(key)),
    ).rejects.toMatchObject({
      name: "AgentNavigationRefusedError",
      code: "agent_navigation_refused",
      message: expect.stringContaining("read-only action cannot move"),
    });
  });

  it("refuses a write nested inside an agent's read", async () => {
    await expect(
      inAction("mcp", true, () =>
        inAction("mcp", false, () => assertNavigateWriteAllowed("navigate")),
      ),
    ).rejects.toBeInstanceOf(AgentNavigationRefusedError);
  });

  it.each([
    ["an agent's read of another key", "mcp", true, "navigation"],
    ["an agent's read of a similar key", "mcp", true, "navigated"],
    ["an agent's write", "mcp", false, "navigate"],
    ["a person's read", "frontend", true, "navigate"],
    ["a CLI read", "cli", true, "navigate"],
  ] as const)("allows %s", async (_label, caller, readOnly, key) => {
    await expect(
      inAction(caller, readOnly, () => assertNavigateWriteAllowed(key)),
    ).resolves.toBeUndefined();
  });

  it("allows a write outside any action", () => {
    expect(() => assertNavigateWriteAllowed("navigate")).not.toThrow();
  });
});
