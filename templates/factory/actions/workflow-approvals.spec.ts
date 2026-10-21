import { describe, expect, it } from "vitest";

import deleteWorkflow from "./delete-factory-workflow.js";
import run from "./run-factory-workflow.js";
import setEnabled from "./set-factory-workflow-enabled.js";

// Core asks a person before it runs an action with `needsApproval` for the
// agent's tool calls, MCP and WebMCP; the app's own buttons are not gated. These
// are the real action entries, so what is checked is what core reads.
async function asksAPerson(
  action: { needsApproval?: unknown },
  args: unknown,
): Promise<boolean> {
  const gate = action.needsApproval;
  if (typeof gate === "function") return Boolean(await gate(args));
  return gate === true;
}

const FACTORY = { factoryId: "support-triage", workflowId: "wf-1" };

describe("what an agent cannot do without a person saying yes", () => {
  it("turning a workflow on asks, and turning it off does not", async () => {
    expect(await asksAPerson(setEnabled, { ...FACTORY, enabled: true })).toBe(
      true,
    );
    expect(await asksAPerson(setEnabled, { ...FACTORY, enabled: false })).toBe(
      false,
    );
  });

  it("a live run asks, and a dry or test run does not", async () => {
    expect(await asksAPerson(run, { ...FACTORY, mode: "live" })).toBe(true);
    expect(await asksAPerson(run, { ...FACTORY, mode: "dry" })).toBe(false);
    expect(
      await asksAPerson(run, { ...FACTORY, mode: "test", testNodeId: "n" }),
    ).toBe(false);
  });

  it("deleting a workflow asks, forced or not", async () => {
    expect(
      await asksAPerson(deleteWorkflow, { ...FACTORY, force: false }),
    ).toBe(true);
    expect(await asksAPerson(deleteWorkflow, { ...FACTORY, force: true })).toBe(
      true,
    );
  });

  it("offers no always-allow, which would turn the gate off for every later call", () => {
    for (const action of [setEnabled, run, deleteWorkflow]) {
      expect(action.allowPersistentApproval).toBe(false);
    }
  });

  it("advertises the three to MCP hosts as destructive", () => {
    for (const action of [setEnabled, run, deleteWorkflow]) {
      expect(action.mcpAnnotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
      });
    }
  });
});
