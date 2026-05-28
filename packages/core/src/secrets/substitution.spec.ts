import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReadAppSecret = vi.fn();
const mockReadAppSecretMeta = vi.fn();
const mockGetRequestOrgId = vi.fn();
const mockGetRequestUserEmail = vi.fn();
const mockResolveCredentialForScope = vi.fn();

vi.mock("./storage.js", () => ({
  readAppSecret: (...args: any[]) => mockReadAppSecret(...args),
  readAppSecretMeta: (...args: any[]) => mockReadAppSecretMeta(...args),
}));

vi.mock("../server/request-context.js", () => ({
  getRequestOrgId: (...args: any[]) => mockGetRequestOrgId(...args),
  getRequestUserEmail: (...args: any[]) => mockGetRequestUserEmail(...args),
}));

vi.mock("../credentials/index.js", () => ({
  resolveCredentialForScope: (...args: any[]) =>
    mockResolveCredentialForScope(...args),
}));

import {
  getResolvedKeyAllowlist,
  resolveKeyReferencesWithRequestScopes,
} from "./substitution.js";

describe("resolveKeyReferencesWithRequestScopes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRequestOrgId.mockReturnValue("org_123");
    mockGetRequestUserEmail.mockReturnValue("alice@example.test");
    mockReadAppSecret.mockResolvedValue(null);
    mockReadAppSecretMeta.mockResolvedValue(null);
    mockResolveCredentialForScope.mockResolvedValue(undefined);
  });

  it("falls back from user scope to active org scope", async () => {
    mockReadAppSecret.mockImplementation(async ({ scope }) =>
      scope === "org" ? { value: "org-token" } : null,
    );

    const result = await resolveKeyReferencesWithRequestScopes(
      "Bearer ${keys.GITHUB_TOKEN}",
      "alice@example.test",
    );

    expect(result.resolved).toBe("Bearer org-token");
    expect(result.usedKeys).toEqual(["GITHUB_TOKEN"]);
    expect(result.secretValues).toEqual(["org-token"]);
    expect(result.resolvedKeys).toEqual([
      {
        name: "GITHUB_TOKEN",
        scope: "org",
        scopeId: "org_123",
      },
    ]);
    expect(mockReadAppSecret).toHaveBeenCalledWith({
      key: "GITHUB_TOKEN",
      scope: "user",
      scopeId: "alice@example.test",
    });
    expect(mockReadAppSecret).toHaveBeenCalledWith({
      key: "GITHUB_TOKEN",
      scope: "org",
      scopeId: "org_123",
    });
  });

  it("uses solo workspace scope when no org is active", async () => {
    mockGetRequestOrgId.mockReturnValue(null);
    mockReadAppSecret.mockImplementation(async ({ scope, scopeId }) =>
      scope === "workspace" && scopeId === "solo:alice@example.test"
        ? { value: "solo-token" }
        : null,
    );

    const result = await resolveKeyReferencesWithRequestScopes(
      "token=${keys.API_TOKEN}",
      "alice@example.test",
    );

    expect(result.resolved).toBe("token=solo-token");
    expect(result.resolvedKeys).toEqual([
      {
        name: "API_TOKEN",
        scope: "workspace",
        scopeId: "solo:alice@example.test",
      },
    ]);
  });

  it("falls back to a legacy user credential after scoped secrets miss", async () => {
    mockResolveCredentialForScope.mockImplementation(async (_key, { scope }) =>
      scope === "user" ? "legacy-user-token" : undefined,
    );

    const result = await resolveKeyReferencesWithRequestScopes(
      "Bearer ${keys.GITHUB_TOKEN}",
      "alice@example.test",
    );

    expect(result.resolved).toBe("Bearer legacy-user-token");
    expect(result.secretValues).toEqual(["legacy-user-token"]);
    expect(result.resolvedKeys).toEqual([
      {
        name: "GITHUB_TOKEN",
        scope: "user",
        scopeId: "alice@example.test",
      },
    ]);
    expect(mockResolveCredentialForScope).toHaveBeenCalledWith("GITHUB_TOKEN", {
      userEmail: "alice@example.test",
      orgId: "org_123",
      scope: "user",
    });
  });

  it("falls back to a legacy org credential after user credential misses", async () => {
    mockResolveCredentialForScope.mockImplementation(async (_key, { scope }) =>
      scope === "org" ? "legacy-org-token" : undefined,
    );

    const result = await resolveKeyReferencesWithRequestScopes(
      "Bearer ${keys.GITHUB_TOKEN}",
      "alice@example.test",
    );

    expect(result.resolved).toBe("Bearer legacy-org-token");
    expect(result.secretValues).toEqual(["legacy-org-token"]);
    expect(result.resolvedKeys).toEqual([
      {
        name: "GITHUB_TOKEN",
        scope: "org",
        scopeId: "org_123",
      },
    ]);
    expect(mockResolveCredentialForScope).toHaveBeenCalledWith("GITHUB_TOKEN", {
      userEmail: "alice@example.test",
      orgId: "org_123",
      scope: "org",
    });
  });

  it("reads allowlists from the resolved scope", async () => {
    mockReadAppSecretMeta.mockResolvedValue({
      urlAllowlist: ["https://api.github.com"],
    });

    await expect(
      getResolvedKeyAllowlist({
        name: "GITHUB_TOKEN",
        scope: "org",
        scopeId: "org_123",
      }),
    ).resolves.toEqual(["https://api.github.com"]);

    expect(mockReadAppSecretMeta).toHaveBeenCalledWith({
      key: "GITHUB_TOKEN",
      scope: "org",
      scopeId: "org_123",
    });
  });
});
