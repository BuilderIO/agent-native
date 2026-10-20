import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveManagedMcpOAuthClientMock = vi.fn();

vi.mock("../oauth-routes.js", () => ({
  resolveManagedMcpOAuthClient: resolveManagedMcpOAuthClientMock,
}));

const readinessAction = (await import("./get-managed-mcp-oauth-readiness.js"))
  .default;

describe("get-managed-mcp-oauth-readiness action", () => {
  beforeEach(() => resolveManagedMcpOAuthClientMock.mockReset());

  it("returns only readiness status for a configured workspace client", async () => {
    resolveManagedMcpOAuthClientMock.mockResolvedValue({
      client_id: "client-id",
      client_secret: "client-secret",
    });

    await expect(
      readinessAction.run(
        {},
        {
          caller: "frontend",
          userEmail: "member@example.com",
          requestHeaders: new Headers(),
        },
      ),
    ).resolves.toEqual({ hubspot: "configured" });
    expect(resolveManagedMcpOAuthClientMock).toHaveBeenCalledWith(
      new URL("https://mcp.hubspot.com"),
    );
  });

  it("reports an absent client without exposing credential values", async () => {
    resolveManagedMcpOAuthClientMock.mockResolvedValue(undefined);
    await expect(
      readinessAction.run(
        {},
        {
          caller: "frontend",
          userEmail: "member@example.com",
          requestHeaders: new Headers(),
        },
      ),
    ).resolves.toEqual({ hubspot: "missing" });
  });

  it("requires an authenticated app UI caller", async () => {
    await expect(
      readinessAction.run({}, { caller: "frontend" }),
    ).rejects.toThrow("Not authenticated.");
    expect(resolveManagedMcpOAuthClientMock).not.toHaveBeenCalled();
  });
});
