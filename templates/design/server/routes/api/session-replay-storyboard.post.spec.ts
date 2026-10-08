import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  deleteAttachment: vi.fn(),
  mintAttachmentRef: vi.fn(),
  readMultipartFormData: vi.fn(),
  runWithRequestContext: vi.fn(),
  runAction: vi.fn(),
  verifyA2AToken: vi.fn(),
}));

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  return {
    ...actual,
    defineEventHandler: (handler: unknown) => handler,
    getHeader: (event: any, name: string) => event.req.headers.get(name),
    readMultipartFormData: (...args: unknown[]) =>
      mocks.readMultipartFormData(...args),
  };
});

vi.mock("@agent-native/core/a2a", () => ({
  verifyA2AToken: mocks.verifyA2AToken,
}));

vi.mock("@agent-native/core/action", () => ({}));

vi.mock("@agent-native/core/private-blob", () => ({
  deleteAttachment: mocks.deleteAttachment,
  mintAttachmentRef: mocks.mintAttachmentRef,
}));

vi.mock("@agent-native/core/server", () => ({
  runWithRequestContext: (...args: unknown[]) =>
    mocks.runWithRequestContext(...args),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("../../../actions/add-session-replay-screenshots-to-board.js", () => ({
  default: { run: mocks.runAction },
}));

import handler from "./session-replay-storyboard.post";

const designId = "design-123";
const screenshot = {
  replayId: "sr_123",
  app: "clips",
  capturedAt: "2026-10-07T12:00:00.000Z",
  route: "/library",
  offsetMs: 1_250,
  viewportWidth: 2,
  viewportHeight: 1,
  eventCount: 3,
};

function pngBytes(width = screenshot.viewportWidth): Buffer {
  const bytes = Buffer.alloc(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(screenshot.viewportHeight, 20);
  return bytes;
}

function makeFormData(width?: number) {
  const form = new FormData();
  form.set(
    "manifest",
    JSON.stringify({
      designId,
      cohortTotal: 1,
      selectedReplayCount: 1,
      screenshots: [screenshot],
    }),
  );
  form.append(
    "screenshot-0",
    new Blob([new Uint8Array(pngBytes(width)).buffer as ArrayBuffer], {
      type: "image/png",
    }),
    "replay.png",
  );
  return form;
}

function makeEvent(body: BodyInit, token = "test-a2a-token") {
  return {
    req: new Request(
      "https://design.example.test/api/session-replay-storyboard",
      {
        method: "POST",
        headers: token ? { authorization: `Bearer ${token}` } : undefined,
        body,
      },
    ),
  };
}

describe("POST /api/session-replay-storyboard", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.verifyA2AToken.mockResolvedValue({
      email: "ada@example.test",
      orgId: "org-1",
    });
    mocks.runWithRequestContext.mockImplementation(
      async (_context: unknown, callback: () => unknown) => callback(),
    );
    mocks.assertAccess.mockResolvedValue({ role: "editor" });
    mocks.mintAttachmentRef.mockResolvedValue({
      status: "ok",
      ref: "private-attachment-ref",
    });
    mocks.deleteAttachment.mockResolvedValue({ status: "ok", deleted: true });
    mocks.runAction.mockResolvedValue({
      boardUrl: "https://design.example.test/design/design-123",
      designId,
      screenshotCount: 1,
    });
    mocks.readMultipartFormData.mockImplementation(async (event: any) => {
      const form = await event.req.formData();
      return Promise.all(
        [...form.entries()].map(async ([name, value]) =>
          typeof value === "string"
            ? { name, data: Buffer.from(value) }
            : {
                name,
                type: value.type,
                filename: value.name,
                data: Buffer.from(await value.arrayBuffer()),
              },
        ),
      );
    });
  });

  it("verifies the Analytics user, writes through the existing Design action, and cleans the temporary ref", async () => {
    const result = await (handler as any)(makeEvent(makeFormData()));

    expect(result).toMatchObject({
      designId,
      screenshotCount: 1,
      selectedReplayCount: 1,
      cohortTotal: 1,
      cleanupPending: false,
    });
    expect(mocks.verifyA2AToken).toHaveBeenCalledWith(
      "test-a2a-token",
      expect.any(Object),
    );
    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design",
      designId,
      "editor",
    );
    expect(mocks.mintAttachmentRef).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerEmail: "ada@example.test",
        orgId: null,
        data: expect.any(Buffer),
      }),
    );
    expect(mocks.runAction).toHaveBeenCalledWith(
      expect.objectContaining({
        designId,
        screenshots: [
          expect.objectContaining({ attachmentRef: "private-attachment-ref" }),
        ],
      }),
      expect.objectContaining({
        actionName: "add-session-replay-screenshots-to-board",
        userEmail: "ada@example.test",
        orgId: "org-1",
      }),
    );
    expect(mocks.deleteAttachment).toHaveBeenCalledWith(
      "private-attachment-ref",
      { ownerEmail: "ada@example.test", orgId: null },
    );
  });

  it("rejects a missing signed Analytics user before parsing or writing", async () => {
    await expect(
      (handler as any)(makeEvent(makeFormData(), "")),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(mocks.verifyA2AToken).not.toHaveBeenCalled();
    expect(mocks.mintAttachmentRef).not.toHaveBeenCalled();
  });

  it("preserves the oversized-request error when body cancellation fails", async () => {
    const reader = {
      cancel: vi
        .fn()
        .mockRejectedValue(new Error("stream cancellation failed")),
      read: vi.fn().mockResolvedValue({
        done: false,
        value: new Uint8Array(21 * 1024 * 1024),
      }),
      releaseLock: vi.fn(),
    };
    const event = {
      req: {
        body: { getReader: () => reader },
        headers: new Headers({ authorization: "Bearer test-a2a-token" }),
      },
    };

    await expect((handler as any)(event)).rejects.toMatchObject({
      statusCode: 413,
      statusMessage: "Screenshot export request is too large",
    });
    expect(reader.cancel).toHaveBeenCalledTimes(1);
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
  });

  it("rejects pixels whose dimensions differ from replay metadata", async () => {
    await expect(
      (handler as any)(makeEvent(makeFormData(3))),
    ).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: "Screenshot pixels do not match the replay viewport",
    });
    expect(mocks.assertAccess).not.toHaveBeenCalled();
    expect(mocks.mintAttachmentRef).not.toHaveBeenCalled();
  });

  it("does not create a partial board when private screenshot storage is unavailable", async () => {
    mocks.mintAttachmentRef.mockResolvedValue({ status: "storageUnavailable" });

    await expect(
      (handler as any)(makeEvent(makeFormData())),
    ).rejects.toMatchObject({
      statusCode: 503,
      statusMessage: "Design private screenshot storage is unavailable",
    });
    expect(mocks.runAction).not.toHaveBeenCalled();
  });

  it("reports when a temporary attachment cannot be cleaned up", async () => {
    mocks.deleteAttachment.mockResolvedValue({ status: "ok", deleted: false });

    const result = await (handler as any)(makeEvent(makeFormData()));

    expect(result.cleanupPending).toBe(true);
  });
});
