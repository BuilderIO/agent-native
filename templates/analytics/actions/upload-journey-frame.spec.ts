import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mintAttachmentRef: vi.fn(),
  getSessionReplaySummary: vi.fn(),
}));

vi.mock("@agent-native/core/private-blob", () => ({
  mintAttachmentRef: mocks.mintAttachmentRef,
}));
vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: () => "owner@example.test",
  getRequestOrgId: () => "org-1",
}));
vi.mock("../server/lib/session-replay.js", () => ({
  getSessionReplaySummary: mocks.getSessionReplaySummary,
}));

import action from "./upload-journey-frame";

function png(width: number, height: number): string {
  const bytes = Buffer.alloc(40);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes.toString("base64");
}

const run = (input: Record<string, unknown>) =>
  (action as unknown as { run: (args: unknown) => Promise<unknown> }).run(
    input,
  );

beforeEach(() => {
  mocks.mintAttachmentRef.mockReset();
  mocks.getSessionReplaySummary.mockReset();
  mocks.getSessionReplaySummary.mockResolvedValue({ id: "sr_1" });
  mocks.mintAttachmentRef.mockResolvedValue({
    status: "ok",
    ref: "attachment:v1:x",
  });
});

describe("upload-journey-frame", () => {
  it("stores the PNG privately for the caller and returns only the ref and size", async () => {
    const result = await run({
      recordingId: "sr_1",
      offsetMs: 1200,
      png: png(1280, 800),
    });
    expect(result).toEqual({
      attachmentRef: "attachment:v1:x",
      width: 1280,
      height: 800,
      bytes: 40,
    });
    expect(mocks.getSessionReplaySummary).toHaveBeenCalledWith("sr_1", {
      userEmail: "owner@example.test",
      orgId: "org-1",
    });
    expect(mocks.mintAttachmentRef).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: "sr_1-00001200.png",
        mimeType: "image/png",
        ownerEmail: "owner@example.test",
        orgId: null,
      }),
    );
  });

  it("stores nothing for a recording the caller cannot open", async () => {
    mocks.getSessionReplaySummary.mockRejectedValue(new Error("not found"));
    await expect(
      run({ recordingId: "sr_x", offsetMs: 0, png: png(10, 10) }),
    ).rejects.toThrow("not found");
    expect(mocks.mintAttachmentRef).not.toHaveBeenCalled();
  });

  it("refuses bytes that are not a screenshot-sized PNG", async () => {
    for (const bad of [
      Buffer.from("not a png at all, just text bytes here").toString("base64"),
      png(0, 5),
      png(9000, 10),
    ]) {
      await expect(
        run({ recordingId: "sr_1", offsetMs: 0, png: bad }),
      ).rejects.toMatchObject({ errorCode: "journey_frame_invalid" });
    }
    expect(mocks.mintAttachmentRef).not.toHaveBeenCalled();
  });

  it("says storage is unavailable instead of returning a ref", async () => {
    mocks.mintAttachmentRef.mockResolvedValue({
      status: "storageUnavailable",
      reason: "not_configured",
    });
    await expect(
      run({ recordingId: "sr_1", offsetMs: 0, png: png(10, 10) }),
    ).rejects.toMatchObject({
      errorCode: "private_storage_unavailable",
      statusCode: 503,
    });
  });
});
