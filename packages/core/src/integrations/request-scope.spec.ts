import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveOrgScopeForEmailMock = vi.hoisted(() => vi.fn());

vi.mock("../org/context.js", () => ({
  resolveOrgScopeForEmail: resolveOrgScopeForEmailMock,
}));

import {
  integrationRequestContext,
  resolveIntegrationRequestScope,
} from "./request-scope.js";

describe("integration request scope", () => {
  beforeEach(() => {
    resolveOrgScopeForEmailMock.mockReset();
  });

  it("preserves confirmed personal scope for a user integration", async () => {
    resolveOrgScopeForEmailMock.mockResolvedValue({ status: "personal" });

    const scope = await resolveIntegrationRequestScope({
      ownerEmail: "owner@example.com",
      principalType: "user",
    });

    expect(scope).toEqual({ orgId: null, orgScope: "personal" });
    expect(integrationRequestContext(scope)).toEqual({
      orgScope: "personal",
    });
  });

  it("preserves organization scope for an integration", async () => {
    resolveOrgScopeForEmailMock.mockResolvedValue({
      status: "organization",
      orgId: "org-123",
    });

    await expect(
      resolveIntegrationRequestScope({ ownerEmail: "owner@example.com" }),
    ).resolves.toEqual({ orgId: "org-123" });
  });

  it("uses deployment scope for a service principal without an organization", async () => {
    await expect(
      resolveIntegrationRequestScope({
        ownerEmail: "integration@example.com",
        principalType: "service",
      }),
    ).resolves.toEqual({
      orgId: null,
      defaultAgentEngineScope: "deployment",
    });
    expect(resolveOrgScopeForEmailMock).not.toHaveBeenCalled();
  });

  it("keeps an explicitly selected organization without resolving again", async () => {
    await expect(
      resolveIntegrationRequestScope({
        ownerEmail: "owner@example.com",
        orgId: " org-123 ",
        principalType: "user",
      }),
    ).resolves.toEqual({ orgId: "org-123" });
    expect(resolveOrgScopeForEmailMock).not.toHaveBeenCalled();
  });

  it("keeps a queued personal scope when the owner later joins an organization", async () => {
    resolveOrgScopeForEmailMock.mockResolvedValue({
      status: "organization",
      orgId: "org-new",
    });
    await expect(
      resolveIntegrationRequestScope({
        ownerEmail: "owner@example.com",
        orgId: null,
        orgScope: "personal",
      }),
    ).resolves.toEqual({ orgId: null, orgScope: "personal" });
    expect(resolveOrgScopeForEmailMock).not.toHaveBeenCalled();
  });

  it("fails closed when a user's organization scope is unknown", async () => {
    resolveOrgScopeForEmailMock.mockResolvedValue({ status: "unknown" });

    await expect(
      resolveIntegrationRequestScope({ ownerEmail: "owner@example.com" }),
    ).rejects.toThrow("organization scope could not be resolved");
  });
});
