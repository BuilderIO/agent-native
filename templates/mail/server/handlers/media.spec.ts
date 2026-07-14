import { beforeEach, describe, expect, it, vi } from "vitest";

const h3 = vi.hoisted(() => ({
  query: {} as Record<string, string>,
  authorization: "Bearer ticket-token",
  body: Buffer.from("file bytes") as Buffer | undefined,
  uploadId: "upload-1",
  status: vi.fn(),
}));
const tickets = vi.hoisted(() => ({
  verify: vi.fn(),
  consume: vi.fn(),
}));
const storage = vi.hoisted(() => ({ store: vi.fn() }));

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  return {
    ...actual,
    getHeader: () => h3.authorization,
    getQuery: () => h3.query,
    getRouterParam: () => h3.uploadId,
    readRawBody: () => h3.body,
    setResponseStatus: h3.status,
  };
});

vi.mock("../lib/attachment-upload-ticket.js", () => ({
  verifyAttachmentUploadTicket: tickets.verify,
  consumeAttachmentUploadTicket: tickets.consume,
}));

vi.mock("../lib/media-upload.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/media-upload.js")>();
  return { ...actual, storeMediaUpload: storage.store };
});

import { uploadAttachmentWithTicket } from "./media.js";

describe("ticketed attachment upload handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h3.query = {};
    h3.authorization = "Bearer ticket-token";
    h3.body = Buffer.from("file bytes");
    h3.uploadId = "upload-1";
    tickets.verify.mockResolvedValue({
      ownerEmail: "owner@example.com",
      ticket: {
        uploadId: "upload-1",
        filename: "upload-1.pdf",
        originalName: "report.pdf",
      },
    });
    storage.store.mockResolvedValue({
      url: "https://files.example.com/upload-1.pdf",
      filename: "upload-1.pdf",
      originalName: "report.pdf",
      mimeType: "application/pdf",
      size: 10,
    });
  });

  it("stores bytes for the ticket owner and consumes the capability", async () => {
    const result = await uploadAttachmentWithTicket({} as never);

    expect(storage.store).toHaveBeenCalledWith({
      ownerEmail: "owner@example.com",
      data: expect.any(Uint8Array),
      filename: "upload-1.pdf",
      originalName: "report.pdf",
    });
    expect(tickets.consume).toHaveBeenCalledWith(
      "owner@example.com",
      "upload-1",
    );
    expect(result).toMatchObject({
      attachment: { filename: "upload-1.pdf", originalName: "report.pdf" },
    });
  });

  it("rejects invalid capabilities before reading or storing bytes", async () => {
    tickets.verify.mockResolvedValue(null);

    await expect(uploadAttachmentWithTicket({} as never)).resolves.toEqual({
      error: "Invalid or expired attachment upload URL",
    });

    expect(h3.status).toHaveBeenCalledWith({}, 401);
    expect(storage.store).not.toHaveBeenCalled();
    expect(tickets.consume).not.toHaveBeenCalled();
  });

  it("does not consume the capability when persistence fails", async () => {
    storage.store.mockRejectedValue(new Error("provider unavailable"));

    await expect(uploadAttachmentWithTicket({} as never)).resolves.toEqual({
      error: "Upload failed",
    });

    expect(h3.status).toHaveBeenCalledWith({}, 500);
    expect(tickets.consume).not.toHaveBeenCalled();
  });
});
