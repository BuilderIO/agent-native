import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  fail: (message: string, details: object) => {
    throw Object.assign(new Error(message), details);
  },
}));
vi.mock("@agent-native/core/application-state", () => ({
  readAppState: mocks.read,
  compareAndSetAppState: mocks.save,
}));
vi.mock("../server/source-workspace.js", () => ({}));

import {
  markNativeLocalExportDocumentReplaced,
  readNativeLocalExportState,
} from "./_native-local-export-server";

const stored = {
  designId: "design-test",
  fileId: "file-test",
  expectedVersionHash: "source-v1",
  export: {
    format: "png",
    viewport: { width: 640, height: 480 },
    pixelRatio: 1,
  },
  schemaVersion: 1,
  requestId: "11111111-1111-4111-8111-111111111111",
  tabId: "test-tab",
  targetDocumentId: "22222222-2222-4222-8222-222222222222",
  status: "pending",
  issuedAt: 1,
  expiresAt: Date.now() + 30_000,
} as const;

describe("native local export state read", () => {
  it("preserves stored JSON order for application-state compare-and-set", async () => {
    mocks.read.mockResolvedValue(stored);

    const state = await readNativeLocalExportState("design-test", "test-tab");

    expect(JSON.stringify(state)).toBe(JSON.stringify(stored));
  });

  it("retires a pending request bound to another document", async () => {
    mocks.read.mockResolvedValue(stored);
    mocks.save.mockReset().mockResolvedValue(true);

    await markNativeLocalExportDocumentReplaced(
      "design-test",
      "test-tab",
      "33333333-3333-4333-8333-333333333333",
    );

    expect(mocks.save).toHaveBeenCalledWith(
      "native-local-export:design-test:test-tab",
      stored,
      expect.objectContaining({
        status: "failed",
        failure: expect.objectContaining({ code: "client-unavailable" }),
      }),
    );
  });

  it("adopts an unbound pending request and preserves it on heartbeat", async () => {
    let current: unknown = { ...stored, targetDocumentId: undefined };
    mocks.read.mockImplementation(async () => current);
    mocks.save.mockReset().mockImplementation(async (_key, expected, next) => {
      if (JSON.stringify(current) !== JSON.stringify(expected)) return false;
      current = next;
      return true;
    });

    await markNativeLocalExportDocumentReplaced(
      "design-test",
      "test-tab",
      stored.targetDocumentId,
    );
    expect(current).toMatchObject({
      status: "pending",
      targetDocumentId: stored.targetDocumentId,
    });
    await markNativeLocalExportDocumentReplaced(
      "design-test",
      "test-tab",
      stored.targetDocumentId,
    );
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });

  it("does not replace a request claimed concurrently by the same document", async () => {
    let current: unknown = { ...stored, targetDocumentId: undefined };
    mocks.read.mockImplementation(async () => current);
    mocks.save.mockReset().mockImplementationOnce(async () => {
      current = {
        ...stored,
        targetDocumentId: undefined,
        status: "running",
        ownerDocumentId: stored.targetDocumentId,
      };
      return false;
    });

    await markNativeLocalExportDocumentReplaced(
      "design-test",
      "test-tab",
      stored.targetDocumentId,
    );

    expect(current).toMatchObject({
      status: "running",
      ownerDocumentId: stored.targetDocumentId,
    });
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });

  it("keeps a pending request bound to the registered document", async () => {
    mocks.read.mockResolvedValue(stored);
    mocks.save.mockClear();

    await markNativeLocalExportDocumentReplaced(
      "design-test",
      "test-tab",
      stored.targetDocumentId,
    );

    expect(mocks.save).not.toHaveBeenCalled();
  });
});
