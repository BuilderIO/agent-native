import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequestOrgId = vi.hoisted(() => vi.fn<() => string | undefined>());
const mockResolveOrgIdForEmail = vi.hoisted(() =>
  vi.fn<(email: string) => Promise<string | null>>(),
);
const mockUserEmail = vi.hoisted(() => vi.fn<() => string | undefined>());

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: () => mockRequestOrgId(),
  getRequestUserEmail: () => mockUserEmail(),
}));

vi.mock("@agent-native/core/org", () => ({
  resolveOrgIdForEmail: (email: string) => mockResolveOrgIdForEmail(email),
}));

// Each `select()` shifts the next queued result, so the scoped query and the
// owner-only diagnostic query can return different rows.
let selectResults: unknown[][] = [];

vi.mock("../db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(selectResults.shift() ?? []),
        }),
      }),
    }),
  }),
  schema: {
    designLocalhostConnections: {
      id: "id",
      bridgeUrl: "bridgeUrl",
      bridgeToken: "bridgeToken",
      rootPath: "rootPath",
      ownerEmail: "ownerEmail",
      orgId: "orgId",
    },
  },
}));

import {
  fetchLocalhostBridge,
  localhostBridgeRequestError,
  LocalhostConnectionError,
  requireLocalhostBridgeToken,
  resolveLocalhostBridgeConnection,
  resolveLocalhostConnectionScope,
} from "./localhost-connection.js";

const SCOPE = { connectionId: "conn_1", ownerEmail: "user@example.com" };

beforeEach(() => {
  selectResults = [];
  mockUserEmail.mockReturnValue("user@example.com");
  mockRequestOrgId.mockReturnValue(undefined);
  mockResolveOrgIdForEmail.mockResolvedValue(null);
});

describe("resolveLocalhostConnectionScope", () => {
  it("uses the request org when the request has one", async () => {
    mockRequestOrgId.mockReturnValue("org_1");

    await expect(resolveLocalhostConnectionScope()).resolves.toEqual({
      ownerEmail: "user@example.com",
      orgId: "org_1",
    });
    expect(mockResolveOrgIdForEmail).not.toHaveBeenCalled();
  });

  it("falls back to the caller's active org when there is no request org", async () => {
    // `pnpm action connect-localhost` and every other CLI caller runs outside a
    // request store, so without this fallback the row lands in a different
    // partition than the same user's browser session reads.
    mockResolveOrgIdForEmail.mockResolvedValue("org_1");

    await expect(resolveLocalhostConnectionScope()).resolves.toEqual({
      ownerEmail: "user@example.com",
      orgId: "org_1",
    });
    expect(mockResolveOrgIdForEmail).toHaveBeenCalledWith("user@example.com");
  });

  it("stays in the personal workspace when the caller has no org at all", async () => {
    await expect(resolveLocalhostConnectionScope()).resolves.toEqual({
      ownerEmail: "user@example.com",
      orgId: null,
    });
  });

  it("refuses to guess a scope for an unauthenticated caller", async () => {
    mockUserEmail.mockReturnValue(undefined);

    await expect(resolveLocalhostConnectionScope()).rejects.toThrow(
      /no authenticated user/,
    );
  });
});

describe("resolveLocalhostBridgeConnection", () => {
  it("returns the transport for a connection in scope", async () => {
    selectResults = [
      [
        {
          bridgeUrl: "http://127.0.0.1:7331",
          bridgeToken: "token",
          rootPath: "/tmp/app",
        },
      ],
    ];

    await expect(
      resolveLocalhostBridgeConnection({ ...SCOPE, orgId: "org_1" }),
    ).resolves.toEqual({
      bridgeUrl: "http://127.0.0.1:7331",
      bridgeToken: "token",
      rootPath: "/tmp/app",
    });
  });

  it("names the org-scope mismatch instead of reporting a generic miss", async () => {
    selectResults = [[], [{ orgId: null }]];

    const error = await resolveLocalhostBridgeConnection({
      ...SCOPE,
      orgId: "org_1",
    }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(LocalhostConnectionError);
    expect(error).toMatchObject({
      errorCode: "connection-scope-mismatch",
      // 4xx is what makes the message reach the client at all — the action
      // route replaces any 500 body with "Internal server error".
      statusCode: 409,
    });
    expect((error as Error).message).toContain("conn_1");
    expect((error as Error).message).toContain("personal workspace");
    expect((error as Error).message).toContain("design connect");
  });

  it("distinguishes a connection that does not exist for this account", async () => {
    selectResults = [[], []];

    const error = await resolveLocalhostBridgeConnection({
      ...SCOPE,
      orgId: null,
    }).catch((err: unknown) => err);

    expect(error).toMatchObject({
      errorCode: "connection-not-found",
      statusCode: 404,
    });
  });

  it("distinguishes a registered connection whose bridge is not running", async () => {
    selectResults = [
      [{ bridgeUrl: null, bridgeToken: "token", rootPath: "/tmp/app" }],
    ];

    const error = await resolveLocalhostBridgeConnection({
      ...SCOPE,
      orgId: null,
    }).catch((err: unknown) => err);

    expect(error).toMatchObject({
      errorCode: "bridge-not-running",
      statusCode: 424,
    });
  });

  it("never echoes the bridge token", async () => {
    selectResults = [
      [{ bridgeUrl: null, bridgeToken: "s3cret-token", rootPath: null }],
    ];

    const error = await resolveLocalhostBridgeConnection({
      ...SCOPE,
      orgId: null,
    }).catch((err: unknown) => err as Error);

    expect((error as Error).message).not.toContain("s3cret-token");
  });
});

describe("bridge round trip", () => {
  it("classifies an unreachable bridge instead of throwing a bare fetch error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    const error = await fetchLocalhostBridge({
      bridgeUrl: "http://127.0.0.1:7331",
      operation: "read-file",
      bridgeToken: "token",
      body: {},
    }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(LocalhostConnectionError);
    expect(error).toMatchObject({
      errorCode: "bridge-unreachable",
      statusCode: 424,
    });
    expect((error as Error).message).toContain("fetch failed");
    vi.unstubAllGlobals();
  });

  it("reads a stale bridge token out of a 401 rather than reporting a crash", () => {
    const error = localhostBridgeRequestError("read-file", 401, "unauthorized");

    expect(error).toMatchObject({
      errorCode: "bridge-auth-rejected",
      statusCode: 409,
    });
    expect(error.message).toContain("stale");
  });

  it("keeps other bridge failures classified so their text reaches the caller", () => {
    const error = localhostBridgeRequestError("list-files", 500, "boom");

    expect(error).toMatchObject({
      errorCode: "bridge-request-failed",
      // < 500 so the action route echoes the message; the bridge is the user's
      // own local process, not an untrusted upstream.
      statusCode: 424,
    });
    expect(error.message).toContain("boom");
  });
});

describe("requireLocalhostBridgeToken", () => {
  it("returns the token when present", () => {
    expect(requireLocalhostBridgeToken("conn_1", "token")).toBe("token");
  });

  it("throws a classified client error when absent", () => {
    try {
      requireLocalhostBridgeToken("conn_1", null);
      expect.unreachable("expected a LocalhostConnectionError");
    } catch (error) {
      expect(error).toMatchObject({
        errorCode: "bridge-token-missing",
        statusCode: 424,
      });
    }
  });
});
