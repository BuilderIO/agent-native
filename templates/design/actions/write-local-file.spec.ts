import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "user@example.com",
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn().mockResolvedValue(undefined),
}));

const mockVerifyWriteGrant = vi.hoisted(() => vi.fn());
vi.mock("../server/lib/verify-write-grant.js", () => ({
  verifyWriteGrant: (...args: unknown[]) => mockVerifyWriteGrant(...args),
}));

let bridgeUrl = "http://127.0.0.1:7666";
let connectionBridgeToken: string | null = null;

function makeSelectChain(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(rows),
      }),
    }),
  };
}

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () =>
      makeSelectChain([{ bridgeUrl, bridgeToken: connectionBridgeToken }]),
  }),
  schema: {
    designLocalhostConnections: {
      id: "id",
      bridgeUrl: "bridgeUrl",
      bridgeToken: "bridgeToken",
      ownerEmail: "ownerEmail",
    },
  },
}));

import action from "./write-local-file.js";

describe("write-local-file", () => {
  beforeEach(() => {
    bridgeUrl = "http://127.0.0.1:7666";
    connectionBridgeToken = null;
    mockVerifyWriteGrant.mockResolvedValue({
      rootPath: "/tmp/app",
      bridgeToken: "bridge-token",
      grantId: "grant-1",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
  });

  it("rejects persisted non-loopback bridge URLs before fetching", async () => {
    bridgeUrl = "https://example.com";

    await expect(
      action.run({
        designId: "design_1",
        connectionId: "conn_1",
        relPath: "index.html",
        content: "<h1>Hello</h1>",
      }),
    ).rejects.toThrow(/loopback/);

    expect(fetch).not.toHaveBeenCalled();
  });

  it("writes to loopback bridge URLs with the grant token", async () => {
    await expect(
      action.run({
        designId: "design_1",
        connectionId: "conn_1",
        relPath: "index.html",
        content: "<h1>Hello</h1>",
      }),
    ).resolves.toMatchObject({ operation: "write", written: true });

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:7666/write-file",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-Bridge-Token": "bridge-token",
        }),
      }),
    );
  });

  it("prefers the connection's current bridge token over the grant snapshot (VE4)", async () => {
    connectionBridgeToken = "fresh-connection-token";

    await action.run({
      designId: "design_1",
      connectionId: "conn_1",
      relPath: "index.html",
      content: "<h1>Hello</h1>",
    });

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:7666/write-file",
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Bridge-Token": "fresh-connection-token",
        }),
      }),
    );
  });

  it("forwards expectedVersionHash to the bridge write-file call", async () => {
    await action.run({
      designId: "design_1",
      connectionId: "conn_1",
      relPath: "index.html",
      content: "<h1>Hello</h1>",
      expectedVersionHash: "123-456",
    });

    const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    const body = JSON.parse(call[1].body as string);
    expect(body.expectedVersionHash).toBe("123-456");
  });

  it("throws a version-conflict error on a 409 from the bridge", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { ok: false, error: "version conflict", currentVersionHash: "9-9" },
          { status: 409 },
        ),
      ),
    );

    await expect(
      action.run({
        designId: "design_1",
        connectionId: "conn_1",
        relPath: "index.html",
        content: "<h1>Hello</h1>",
        expectedVersionHash: "stale-hash",
      }),
    ).rejects.toThrow(/version conflict/);
  });

  it.each([".ENV", "ID_RSA", "KEY.PEM", "secrets/SECRET.PEM"])(
    "rejects uppercase/mixed-case secret-looking paths (%s)",
    async (relPath) => {
      await expect(
        action.run({
          designId: "design_1",
          connectionId: "conn_1",
          relPath,
          content: "nope",
        }),
      ).rejects.toThrow(/secret|VCS-internal/);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("surfaces a bridge 401 as a stale-token error with re-grant instructions (VE4)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unauthorized", { status: 401 })),
    );

    await expect(
      action.run({
        designId: "design_1",
        connectionId: "conn_1",
        relPath: "index.html",
        content: "<h1>Hello</h1>",
      }),
    ).rejects.toThrow(/stale[\s\S]*design connect[\s\S]*re-grant/);
  });

  it("patches via a single /apply-edit call without a /read-file pre-read (VE9)", async () => {
    await expect(
      action.run({
        designId: "design_1",
        connectionId: "conn_1",
        relPath: "styles.css",
        patch: { search: "red", replace: "blue" },
      }),
    ).resolves.toMatchObject({ operation: "patch", written: true });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:7666/apply-edit",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
