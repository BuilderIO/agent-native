import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildProductionPrivacyInventory: vi.fn(),
}));

vi.mock("@agent-native/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core")>()),
  defineAction: (definition: unknown) => definition,
}));

vi.mock("../server/lib/privacy-inventory.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/privacy-inventory.js")
  >()),
  buildProductionPrivacyInventory: mocks.buildProductionPrivacyInventory,
}));

import action from "./production-privacy-inventory";

const inventory = {
  schemaVersion: 1 as const,
  generatedAt: "2026-07-16T18:00:00.000Z",
  authorizationClass: "deployment-security-admin" as const,
  counts: {},
  coverage: {},
  evidence: { outputHash: "a".repeat(64) },
};

describe("production-privacy-inventory", () => {
  beforeEach(() => {
    vi.stubEnv(
      "AGENT_NATIVE_PRIVACY_INVENTORY_ADMIN_EMAILS",
      "security@example.com",
    );
    mocks.buildProductionPrivacyInventory.mockReset();
    mocks.buildProductionPrivacyInventory.mockResolvedValue(inventory);
  });

  it("allows only an explicitly allowlisted human caller", async () => {
    await expect(
      action.run(
        {},
        {
          caller: "frontend",
          userEmail: "SECURITY@example.com",
          orgId: null,
          operatorAuthorized: true,
        },
      ),
    ).resolves.toBe(inventory);
  });

  it.each(["tool", "mcp", "a2a"] as const)(
    "rejects %s without server-established operator proof",
    async (caller) => {
      await expect(
        action.run(
          {},
          {
            caller,
            userEmail: "security@example.com",
            orgId: null,
            operatorAuthorized: false,
          },
        ),
      ).rejects.toThrow("Privacy inventory access denied");
      expect(mocks.buildProductionPrivacyInventory).not.toHaveBeenCalled();
    },
  );

  it("rejects ordinary signed-in users without querying aggregates", async () => {
    await expect(
      action.run(
        {},
        {
          caller: "http",
          userEmail: "member@example.com",
          orgId: null,
          operatorAuthorized: true,
        },
      ),
    ).rejects.toThrow("Privacy inventory access denied");
    expect(mocks.buildProductionPrivacyInventory).not.toHaveBeenCalled();
  });

  it("is hidden from agents and sandboxed extension calls and audits the read", () => {
    expect(action.agentTool).toBe(false);
    expect(action.toolCallable).toBe(false);
    expect(action.requiresAuth).toBe(true);
    expect(action.readOnly).toBe(true);
    expect(action.operatorOnly).toEqual({
      tokenEnv: "AGENT_NATIVE_PRIVACY_INVENTORY_ADMIN_TOKEN",
      adminEmailsEnv: "AGENT_NATIVE_PRIVACY_INVENTORY_ADMIN_EMAILS",
    });
    expect(action.audit).toMatchObject({
      onRead: true,
      required: true,
      recordInputs: false,
    });
    const summary = action.audit?.summary?.({}, inventory, {
      status: "success",
      caller: "frontend",
    });
    expect(summary).toContain("deployment-security-admin");
    expect(summary).toContain(inventory.evidence.outputHash);
    expect(summary).not.toContain("security@example.com");
  });
});
