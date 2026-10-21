import { beforeEach, describe, expect, it, vi } from "vitest";

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
  planNativeLocalExportDocumentRegistration,
  readNativeLocalExportRevision,
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
  beforeEach(() => mocks.read.mockReset());

  it("preserves stored JSON order for application-state compare-and-set", async () => {
    mocks.read.mockResolvedValue(stored);

    const state = await readNativeLocalExportState("design-test", "test-tab");

    expect(JSON.stringify(state)).toBe(JSON.stringify(stored));
  });

  it("validates and preserves the request revision snapshot for compare-and-set", async () => {
    const storedRevision = {
      revision: "33333333-3333-4333-8333-333333333333",
      schemaVersion: 1,
    };
    mocks.read.mockResolvedValue(storedRevision);

    await expect(
      readNativeLocalExportRevision("design-test", "test-tab"),
    ).resolves.toBe(storedRevision);
    expect(mocks.read).toHaveBeenCalledWith(
      "native-local-export-revision:design-test:test-tab",
    );
  });

  it("reports unreadable request revisions", async () => {
    mocks.read.mockResolvedValue({ schemaVersion: 1, revision: "invalid" });

    await expect(
      readNativeLocalExportRevision("design-test", "test-tab"),
    ).rejects.toMatchObject({ errorCode: "native_export_request_unreadable" });
  });

  it("retires a pending request bound to another document", () => {
    expect(
      planNativeLocalExportDocumentRegistration(
        stored,
        "33333333-3333-4333-8333-333333333333",
      ),
    ).toMatchObject({
      status: "failed",
      failure: { code: "client-unavailable" },
    });
  });

  it("adopts an unbound pending request and preserves it on heartbeat", () => {
    const adopted = planNativeLocalExportDocumentRegistration(
      { ...stored, targetDocumentId: undefined },
      stored.targetDocumentId,
    );
    expect(adopted).toMatchObject({
      status: "pending",
      targetDocumentId: stored.targetDocumentId,
    });
    expect(
      planNativeLocalExportDocumentRegistration(
        adopted,
        stored.targetDocumentId,
      ),
    ).toBe(adopted);
  });

  it("preserves a request already claimed by the registering document", () => {
    const running = {
      ...stored,
      targetDocumentId: undefined,
      status: "running" as const,
      ownerDocumentId: stored.targetDocumentId,
    };
    expect(
      planNativeLocalExportDocumentRegistration(
        running,
        stored.targetDocumentId,
      ),
    ).toBe(running);
  });

  it("keeps a pending request bound to the registered document", () => {
    expect(
      planNativeLocalExportDocumentRegistration(
        stored,
        stored.targetDocumentId,
      ),
    ).toBe(stored);
  });
});
