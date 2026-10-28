import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn().mockResolvedValue(undefined),
  fetch: vi.fn(),
  getDb: vi.fn(),
  verifyReceipt: vi.fn().mockResolvedValue(true),
  issueChallenge: vi.fn().mockReturnValue("server-challenge"),
  resolveScope: vi.fn().mockResolvedValue({
    ownerEmail: "motion-test@example.invalid",
    orgId: null,
  }),
  resolveConnection: vi.fn().mockResolvedValue({
    bridgeUrl: "http://127.0.0.1:3210",
    bridgeToken: "fake-test-bridge-token",
  }),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
  fail: (message: string) => {
    throw new Error(message);
  },
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("../server/lib/localhost-connection.js", () => ({
  fetchLocalhostBridge: mocks.fetch,
  localhostBridgeRequestError: (
    operation: string,
    status: number,
    message: string,
  ) => new Error(`Bridge ${operation} failed (${status}): ${message}`),
  requireLocalhostBridgeToken: () => "fake-test-bridge-token",
  resolveLocalhostBridgeConnection: mocks.resolveConnection,
  resolveLocalhostConnectionScope: mocks.resolveScope,
}));

vi.mock("../server/db/index.js", () => ({
  getDb: mocks.getDb,
  schema: { designs: { data: "design.data", id: "design.id" } },
}));

vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => args,
}));

vi.mock("./motion-localhost-relay.js", () => ({
  localhostBridgeRelayStep: vi.fn(),
  verifyLocalhostBridgeReceipt: mocks.verifyReceipt,
}));

vi.mock("./visual-edit-browser-request.js", () => ({
  createLocalhostBridgeRelay: (relay: unknown) => relay,
  issueLocalhostBridgeChallenge: mocks.issueChallenge,
  isLocalhostBridgeRelayRequest: () => false,
}));

import action from "./read-local-file.js";

describe("read-local-file bridge response contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertAccess.mockResolvedValue(undefined);
    mocks.resolveScope.mockResolvedValue({
      ownerEmail: "motion-test@example.invalid",
      orgId: null,
    });
    mocks.resolveConnection.mockResolvedValue({
      bridgeUrl: "http://127.0.0.1:3210",
      bridgeToken: "fake-test-bridge-token",
    });
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        content: "const motion = true;\n",
        versionHash: "a".repeat(64),
      }),
    });
    mocks.getDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () =>
              Promise.resolve([
                {
                  data: {
                    sourceType: "localhost",
                    connectionId: "connection-test",
                    screenMetadata: {
                      "screen-test": {
                        sourceType: "localhost",
                        connectionId: "connection-test",
                        sourceFile: "app/routes/home.tsx",
                      },
                    },
                  },
                },
              ]),
          }),
        }),
      }),
    });
    mocks.verifyReceipt.mockResolvedValue(true);
  });

  it("returns complete source content and its bridge version hash", async () => {
    await expect(
      action.run({
        designId: "design-test",
        connectionId: "connection-test",
        path: "src/motion.tsx",
      }),
    ).resolves.toEqual({
      designId: "design-test",
      connectionId: "connection-test",
      path: "src/motion.tsx",
      content: "const motion = true;\n",
      versionHash: "a".repeat(64),
      readonly: false,
    });
  });

  it.each([
    { versionHash: "a".repeat(64) },
    { content: "const motion = true;\n" },
    { content: null, versionHash: "a".repeat(64) },
  ])("rejects incomplete bridge file responses: %o", async (body) => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(body),
    });

    await expect(
      action.run({
        designId: "design-test",
        connectionId: "connection-test",
        path: "src/motion.tsx",
      }),
    ).rejects.toThrow(
      /invalid response; expected string content and versionHash/,
    );
  });

  it("rejects malformed JSON instead of returning an empty source", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockRejectedValue(new SyntaxError("invalid JSON")),
    });

    await expect(
      action.run({
        designId: "design-test",
        connectionId: "connection-test",
        path: "src/motion.tsx",
      }),
    ).rejects.toThrow(
      /invalid response; expected string content and versionHash/,
    );
  });

  it("roots module verification in saved screen metadata and returns no source", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        routePath: "app/routes/home.tsx",
        modulePath: "app/components/Card.tsx",
        reachable: true,
        operationReceipt: "a".repeat(64),
      }),
    });

    await expect(
      action.run({
        designId: "design-test",
        connectionId: "connection-test",
        path: "app/components/Card.tsx",
        motionScreenId: "screen-test",
      }),
    ).resolves.toEqual({
      designId: "design-test",
      connectionId: "connection-test",
      routePath: "app/routes/home.tsx",
      modulePath: "app/components/Card.tsx",
      reachable: true,
      operationReceipt: "a".repeat(64),
    });
    expect(mocks.fetch).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "verify-module-provenance",
        body: {
          routePath: "app/routes/home.tsx",
          modulePath: "app/components/Card.tsx",
          motionRelayChallenge: "server-challenge",
        },
      }),
    );
  });

  it("rejects a persisted path when the bridge graph says it is unrelated", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        routePath: "app/routes/home.tsx",
        modulePath: "app/other/Unrelated.tsx",
        reachable: false,
        operationReceipt: "a".repeat(64),
      }),
    });

    await expect(
      action.run({
        designId: "design-test",
        connectionId: "connection-test",
        path: "app/other/Unrelated.tsx",
        motionScreenId: "screen-test",
      }),
    ).rejects.toThrow(/not imported by the selected screen/);
  });
});
