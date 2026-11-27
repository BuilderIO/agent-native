import type { H3Event } from "h3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyAuthMock = vi.hoisted(() => vi.fn());

vi.mock("../db/ddl-guard.js", () => ({
  ensureColumnExists: vi.fn().mockResolvedValue(undefined),
  ensureIndexExists: vi.fn().mockResolvedValue(undefined),
  ensureIndexExistsConcurrently: vi.fn().mockResolvedValue(undefined),
  ensureTableExists: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../mcp/oauth-route.js", () => ({
  getMcpConnectUrl: () => "http://localhost/_agent-native/mcp/connect",
  getMcpOAuthAudiences: () => ["http://localhost/_agent-native/mcp"],
}));

vi.mock("../mcp/build-server.js", () => ({
  McpIdentityVerificationUnavailableError: class extends Error {},
  McpIdentityVerificationRefusedError: class extends Error {},
  verifyAuth: verifyAuthMock,
  resolveMcpIdentityOrgId: async () => null,
}));

const { getMcpOAuthBearerSession } = await import("./auth.js");

function bearerEvent(): H3Event {
  const headers = new Headers({
    host: "localhost",
    authorization: "Bearer issued-token",
  });
  const event = {
    req: { method: "POST", url: "http://localhost/", headers },
    url: new URL("http://localhost/_agent-native/actions/list"),
    res: { headers: new Headers(), status: 200 },
    node: {
      req: {
        headers: { host: "localhost", authorization: "Bearer issued-token" },
        url: "/_agent-native/actions/list",
        method: "POST",
      },
      res: { setHeader: vi.fn(), getHeader: vi.fn(), appendHeader: vi.fn() },
    },
    headers,
    context: {},
    path: "/_agent-native/actions/list",
  };
  return event as unknown as H3Event;
}

describe("getMcpOAuthBearerSession", () => {
  beforeEach(() => {
    verifyAuthMock.mockReset();
    verifyAuthMock.mockImplementation(
      async (
        _header: string,
        _token: undefined,
        options: { event?: H3Event },
      ) =>
        options.event
          ? {
              authed: true,
              identity: { userEmail: "dev@local.test", orgId: null },
            }
          : { authed: false, refusal: "local-dev-identity" },
    );
  });

  it("hands the request to verifyAuth so a loopback dev-identity token is admitted", async () => {
    const event = bearerEvent();

    const session = await getMcpOAuthBearerSession(event);

    expect(session).toMatchObject({ email: "dev@local.test" });
    expect(verifyAuthMock).toHaveBeenCalledWith(
      "Bearer issued-token",
      undefined,
      expect.objectContaining({ event }),
    );
  });
});
