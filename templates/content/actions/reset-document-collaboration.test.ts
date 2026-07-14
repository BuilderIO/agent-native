import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  deleteCollabState: vi.fn(),
  loadAwarenessRowsStrict: vi.fn(),
  releaseDoc: vi.fn(),
  writeAppState: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: mocks.writeAppState,
}));
vi.mock("@agent-native/core/collab", () => ({
  AGENT_CLIENT_ID: 2_147_483_647,
  deleteCollabState: mocks.deleteCollabState,
  loadAwarenessRowsStrict: mocks.loadAwarenessRowsStrict,
  releaseDoc: mocks.releaseDoc,
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

import resetDocumentCollaboration from "./reset-document-collaboration.js";

describe("reset-document-collaboration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadAwarenessRowsStrict.mockResolvedValue([]);
  });

  it("resets a closed document after checking editor access", async () => {
    const result = await resetDocumentCollaboration.run({ id: "doc-1" });

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "document",
      "doc-1",
      "editor",
    );
    expect(mocks.releaseDoc).toHaveBeenCalledWith("doc-1");
    expect(mocks.deleteCollabState).toHaveBeenCalledWith("doc-1");
    expect(result).toMatchObject({ id: "doc-1", reset: true });
  });

  it("fails closed while a human collaboration client is active", async () => {
    mocks.loadAwarenessRowsStrict.mockResolvedValue([
      { clientId: 42, state: "{}", lastSeen: Date.now() },
    ]);

    await expect(
      resetDocumentCollaboration.run({ id: "doc-1" }),
    ).rejects.toThrow("Close every editor");
    expect(mocks.releaseDoc).not.toHaveBeenCalled();
    expect(mocks.deleteCollabState).not.toHaveBeenCalled();
  });

  it("ignores the reserved agent presence row", async () => {
    mocks.loadAwarenessRowsStrict.mockResolvedValue([
      { clientId: 2_147_483_647, state: "{}", lastSeen: Date.now() },
    ]);

    await expect(
      resetDocumentCollaboration.run({ id: "doc-1" }),
    ).resolves.toMatchObject({ reset: true });
  });
});
