import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: () => "alice@example.com",
}));

vi.mock("../server/lib/dispatch-remote-commands.js", () => ({
  enqueueRemoteCodeCommand: vi.fn(),
}));

import action from "./send-code-agent-remote-command.js";

async function gate(command: Record<string, unknown>) {
  const needsApproval = action.needsApproval;
  if (typeof needsApproval !== "function") throw new Error("no gate");
  return needsApproval({ command }, { caller: "tool" });
}

describe("send-code-agent-remote-command approval", () => {
  it.each([
    { type: "create", prompt: "fix it" },
    { type: "continue", runRef: "r1", text: "go on" },
    { type: "approve", approvalId: "a1" },
  ])("asks for $type", async (command) => {
    expect(await gate(command)).toBe(true);
  });

  it.each([
    { type: "list" },
    { type: "status" },
    { type: "deny", approvalId: "a1" },
    { type: "stop", runRef: "r1" },
  ])("does not ask for $type", async (command) => {
    expect(await gate(command)).toBe(false);
  });

  it("never offers persistent approval", () => {
    expect(action.allowPersistentApproval).toBe(false);
  });
});
