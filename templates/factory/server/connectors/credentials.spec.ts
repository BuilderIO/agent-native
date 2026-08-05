import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readAppSecret: vi.fn(),
  resolveCredential: vi.fn(),
  resolveOrgIdForEmail: vi.fn(),
  select: vi.fn(),
}));

vi.mock("@agent-native/core/credentials", () => ({
  resolveCredential: mocks.resolveCredential,
}));
vi.mock("@agent-native/core/org", () => ({
  orgMembers: { email: "email", orgId: "org_id" },
  resolveOrgIdForEmail: mocks.resolveOrgIdForEmail,
}));
vi.mock("@agent-native/core/secrets", () => ({
  readAppSecret: mocks.readAppSecret,
}));
vi.mock("../db/index.js", () => ({
  getDb: () => ({ select: mocks.select }),
}));

import { resolveConnectorSecret } from "./credentials.js";

describe("resolveConnectorSecret", () => {
  const userEmail = "owner@example.com";

  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    mocks.readAppSecret.mockResolvedValue(null);
    mocks.resolveCredential.mockResolvedValue(undefined);
    mocks.resolveOrgIdForEmail.mockResolvedValue("active-org");
    mocks.select.mockReturnValue({
      from: () => ({
        where: async () => [{ orgId: "active-org" }],
      }),
    });
  });

  it("prefers the designated Dispatch vault over a deployment fallback", async () => {
    vi.stubEnv("AGENT_VAULT_ORG_ID", "dispatch-org");
    vi.stubEnv("FACTORY_TEST_CONNECTOR_KEY", "deployment-value");
    mocks.readAppSecret.mockImplementation(async ({ scope, scopeId }) =>
      scope === "workspace" && scopeId === "dispatch-org"
        ? { value: "dispatch-value" }
        : null,
    );

    await expect(
      resolveConnectorSecret("FACTORY_TEST_CONNECTOR_KEY", userEmail, {
        orgId: "active-org",
      }),
    ).resolves.toBe("dispatch-value");
  });

  it("uses the deployment fallback only when shared scopes miss", async () => {
    vi.stubEnv("FACTORY_TEST_CONNECTOR_KEY", " deployment-value ");

    await expect(
      resolveConnectorSecret("FACTORY_TEST_CONNECTOR_KEY", userEmail, {
        orgId: "active-org",
      }),
    ).resolves.toBe("deployment-value");
  });
});
