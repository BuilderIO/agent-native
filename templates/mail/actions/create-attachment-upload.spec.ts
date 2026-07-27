import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  ownerEmail: "owner@example.com" as string | null,
}));
const createTicket = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  getAppProductionUrl: () => "https://apps.example.com",
  getRequestUserEmail: () => auth.ownerEmail,
  withConfiguredAppBasePath: (url: string) => `${url}/mail`,
}));

vi.mock("../server/lib/attachment-upload-ticket.js", () => ({
  createAttachmentUploadTicket: createTicket,
}));

describe("create-attachment-upload", () => {
  beforeEach(() => {
    auth.ownerEmail = "owner@example.com";
    createTicket.mockReset().mockResolvedValue({
      uploadId: "upload-1",
      token: "secret-token",
      filename: "upload-1.pdf",
      originalName: "report.pdf",
      mimeType: "application/pdf",
      expiresAt: Date.parse("2026-07-14T12:05:00Z"),
    });
  });

  it("returns a base-path-aware raw-byte upload capability", async () => {
    const action = (await import("./create-attachment-upload.js")).default;

    const result = await action.run({ originalName: "report.pdf" });

    expect(createTicket).toHaveBeenCalledWith(
      "owner@example.com",
      "report.pdf",
    );
    expect(result).toMatchObject({
      method: "PUT",
      uploadUrl:
        "https://apps.example.com/mail/api/media/attachment-upload/upload-1",
      headers: { Authorization: "Bearer secret-token" },
      attachment: {
        filename: "upload-1.pdf",
        originalName: "report.pdf",
        mimeType: "application/pdf",
      },
    });
  });

  it("requires an authenticated owner", async () => {
    auth.ownerEmail = null;
    const action = (await import("./create-attachment-upload.js")).default;

    await expect(action.run({ originalName: "report.pdf" })).rejects.toThrow(
      "Authentication required",
    );
  });
});
