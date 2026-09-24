import { beforeEach, describe, expect, it, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("../a2a/invoke.js", () => ({ invokeAgentAction: invoke }));
vi.mock("../a2a/caller-auth.js", () => ({
  resolveA2ACallerAuth: async () => ({
    userEmail: "owner@example.test",
    orgDomain: "example.test",
    orgSecret: "EXAMPLE_TEST_ONLY",
  }),
}));
import { readOwnerDesignSystem } from "./design-system-owner-read.js";
beforeEach(() => vi.clearAllMocks());

describe("owner-qualified design-system read", () => {
  it("uses scoped A2A action, unwraps its actual envelope and validates owner and pinned revision", async () => {
    invoke.mockResolvedValue({
      result: {
        action: "get-design-system",
        status: "completed",
        output: JSON.stringify({
          id: "same-id",
          title: "Design owner",
          agentContext: "actual",
          reference: { systemId: "same-id", ownerApp: "design", revision: 3 },
        }),
      },
    });
    const result = await readOwnerDesignSystem("slides", {
      id: "same-id",
      ownerApp: "design",
      consumedRevision: 3,
    });
    expect(result.title).toBe("Design owner");
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "design",
        selfAppId: "slides",
        action: "get-design-system",
        userEmail: "owner@example.test",
        input: { id: "same-id", ownerApp: "design", consumedRevision: 3 },
      }),
    );
    await expect(
      readOwnerDesignSystem("slides", {
        id: "same-id",
        ownerApp: "design",
        consumedRevision: 2,
      }),
    ).rejects.toMatchObject({
      errorCode: "design_system_revision_unavailable",
      statusCode: 409,
    });
  });
  it("fails explicitly instead of returning local/latest on provider failure or mismatched identity", async () => {
    invoke.mockResolvedValue({
      result: { status: "failed", output: "not accessible" },
    });
    await expect(
      readOwnerDesignSystem("slides", { id: "same-id", ownerApp: "design" }),
    ).rejects.toMatchObject({ statusCode: 409 });
    invoke.mockResolvedValue({
      result: {
        status: "completed",
        output: JSON.stringify({
          id: "same-id",
          title: "Wrong app",
          agentContext: "local",
          reference: { systemId: "same-id", ownerApp: "slides", revision: 0 },
        }),
      },
    });
    await expect(
      readOwnerDesignSystem("slides", { id: "same-id", ownerApp: "design" }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});
