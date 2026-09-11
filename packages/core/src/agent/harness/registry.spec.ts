import { describe, expect, it } from "vitest";

import {
  getAgentHarnessEntry,
  listAgentHarnesses,
  registerAgentHarness,
  resolveAgentHarness,
} from "./registry.js";
import type { AgentHarnessAdapter } from "./types.js";

function adapter(name: string): AgentHarnessAdapter {
  return {
    name,
    label: name,
    description: "test harness",
    capabilities: {
      sandbox: false,
      resumable: true,
      approvals: false,
      hostTools: false,
      fileEvents: false,
    },
    async createSession() {
      throw new Error("not used");
    },
  };
}

describe("agent harness registry", () => {
  it("registers and resolves custom harness adapters", () => {
    registerAgentHarness({
      name: "test:harness",
      label: "Test Harness",
      description: "A test harness",
      capabilities: adapter("test:harness").capabilities,
      create: () => adapter("test:harness"),
    });

    expect(getAgentHarnessEntry("test:harness")?.label).toBe("Test Harness");
    expect(
      listAgentHarnesses().some((entry) => entry.name === "test:harness"),
    ).toBe(true);
    expect(resolveAgentHarness("test:harness").name).toBe("test:harness");
  });

  it("throws for unknown harnesses", () => {
    expect(() => resolveAgentHarness("missing:harness")).toThrow(
      /Unknown harness/,
    );
  });
});
