import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn().mockResolvedValue(undefined),
  fetch: vi.fn(),
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

vi.mock("./motion-localhost-relay.js", () => ({
  localhostBridgeRelayStep: vi.fn(),
}));

vi.mock("./visual-edit-browser-request.js", () => ({
  createLocalhostBridgeRelay: vi.fn(),
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
});
