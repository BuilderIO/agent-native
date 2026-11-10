import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  issuer: vi.fn(),
  context: vi.fn(),
}));
vi.mock("../client-connections.js", () => ({
  listMcpClientConnections: mocks.list,
}));
vi.mock("../oauth-route.js", () => ({ resolveMcpOAuthIssuer: mocks.issuer }));
vi.mock("../../server/request-context.js", () => ({
  getRequestContext: mocks.context,
}));

import action from "./list-mcp-client-connections.js";

describe("list MCP client connections", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.context.mockReturnValue({
      requestOrigin: "https://app.example.test",
    });
    mocks.issuer.mockReturnValue("https://app.example.test");
  });

  it("requires a signed-in user before reading connections", async () => {
    await expect(action.run({}, {})).rejects.toMatchObject({
      errorCode: "unauthorized",
      statusCode: 401,
    });
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("uses the normalized user, active organization and resolved resource", async () => {
    const result = {
      connections: [{ client: "cursor", status: "connected", lastUsedAt: 42 }],
    };
    mocks.list.mockResolvedValue(result);
    await expect(
      action.run({}, { userEmail: " User@Example.Test ", orgId: "org-a" }),
    ).resolves.toEqual(result);
    expect(mocks.issuer).toHaveBeenCalledWith("https://app.example.test");
    expect(mocks.list).toHaveBeenCalledWith({
      email: "user@example.test",
      orgId: "org-a",
      issuer: "https://app.example.test",
    });
  });

  it("reports an unavailable resource or failed lookup instead of an empty list", async () => {
    mocks.issuer.mockReturnValueOnce(null);
    await expect(
      action.run({}, { userEmail: "user@example.test" }),
    ).rejects.toMatchObject({
      errorCode: "mcp_connections_unavailable",
      statusCode: 503,
    });
    expect(mocks.list).not.toHaveBeenCalled();
    mocks.list.mockRejectedValueOnce(new Error("database unavailable"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      action.run({}, { userEmail: "user@example.test" }),
    ).rejects.toMatchObject({
      errorCode: "mcp_connections_unavailable",
      statusCode: 503,
    });
    log.mockRestore();
  });
});
