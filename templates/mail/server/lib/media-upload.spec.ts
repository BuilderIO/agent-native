import {
  getRequestContext,
  runWithRequestContext,
} from "@agent-native/core/server/request-context";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const uploadFile = vi.hoisted(() => vi.fn());
const uploadStore = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
}));

vi.mock("@agent-native/core/file-upload", () => ({ uploadFile }));
vi.mock("./upload-store.js", () => ({
  getStoredUpload: uploadStore.get,
  putStoredUpload: uploadStore.put,
}));

describe("storeMediaUpload", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "production";
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("persists provider metadata and verifies it before returning a handle", async () => {
    uploadFile.mockImplementation(async () => {
      expect(getRequestContext()).toMatchObject({
        userEmail: "owner@example.com",
        orgId: "org-1",
      });
      return {
        url: "https://files.example.com/report.pdf",
        provider: "test-provider",
      };
    });
    uploadStore.get.mockResolvedValue({
      filename: "upload-1.pdf",
      url: "https://files.example.com/report.pdf",
    });
    const { storeMediaUpload } = await import("./media-upload.js");

    const result = await runWithRequestContext(
      { userEmail: "request@example.com", orgId: "org-1" },
      () =>
        storeMediaUpload({
          ownerEmail: "owner@example.com",
          data: new Uint8Array([1, 2, 3]),
          filename: "upload-1.pdf",
          originalName: "report.pdf",
        }),
    );

    expect(uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerEmail: "owner@example.com",
        filename: "report.pdf",
        mimeType: "application/pdf",
        recordAsset: false,
      }),
    );
    expect(uploadStore.put).toHaveBeenCalledWith(
      "owner@example.com",
      expect.objectContaining({
        filename: "upload-1.pdf",
        url: "https://files.example.com/report.pdf",
      }),
    );
    expect(result).toMatchObject({
      filename: "upload-1.pdf",
      url: "https://files.example.com/report.pdf",
      provider: "test-provider",
    });
  });

  it("fails closed in production when durable file storage is unavailable", async () => {
    uploadFile.mockResolvedValue(null);
    const { MediaStorageSetupError, storeMediaUpload } =
      await import("./media-upload.js");

    await expect(
      storeMediaUpload({
        ownerEmail: "owner@example.com",
        data: new Uint8Array([1]),
        filename: "upload-1.txt",
        originalName: "note.txt",
      }),
    ).rejects.toBeInstanceOf(MediaStorageSetupError);
  });

  describe("when the provider refuses the upload", () => {
    const upload = {
      ownerEmail: "owner@example.com",
      data: new Uint8Array([1, 2, 3]),
      filename: "upload-1.pdf",
      originalName: "invoice.pdf",
    };

    beforeEach(() => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it.each([
      [
        "a rejected credential",
        Object.assign(new Error("Builder.io upload failed (401): no"), {
          status: 401,
          errorCode: "builder_credentials_rejected",
        }),
      ],
      [
        "a grant that needs signing in again",
        Object.assign(new Error("Reconnect"), {
          errorCode: "builder_oauth_reauthorization_required",
        }),
      ],
      [
        "a refused upload",
        Object.assign(new Error("Builder.io upload failed (403): no"), {
          status: 403,
        }),
      ],
      [
        "a connection missing its space",
        new Error(
          "Builder personal access token connection is missing its space id. Sign in to Builder.io again to continue.",
        ),
      ],
    ])("asks to reconnect after %s", async (_name, failure) => {
      uploadFile.mockRejectedValue(failure);
      const { BUILDER_RECONNECT_MESSAGE, storeMediaUpload } =
        await import("./media-upload.js");

      await expect(storeMediaUpload(upload)).rejects.toMatchObject({
        message: BUILDER_RECONNECT_MESSAGE,
        storageSetupRequired: true,
      });
    });

    it("doesn't blame the connection for an expired signed URL", async () => {
      const failure = Object.assign(new Error("GCS upload failed (403): no"), {
        status: 403,
      });
      uploadFile.mockRejectedValue(failure);
      const { storeMediaUpload } = await import("./media-upload.js");

      await expect(storeMediaUpload(upload)).rejects.toBe(failure);
    });

    it("doesn't blame Builder for another storage provider's refusal", async () => {
      const failure = Object.assign(new Error("Access denied"), {
        status: 403,
      });
      uploadFile.mockRejectedValue(failure);
      const { storeMediaUpload } = await import("./media-upload.js");

      await expect(storeMediaUpload(upload)).rejects.toBe(failure);
    });

    it("passes other failures through unchanged", async () => {
      const failure = Object.assign(
        new Error("Builder.io upload failed (500)"),
        { status: 500 },
      );
      uploadFile.mockRejectedValue(failure);
      const { storeMediaUpload } = await import("./media-upload.js");

      await expect(storeMediaUpload(upload)).rejects.toBe(failure);
    });
  });
});

describe("mimeTypeForUpload", () => {
  it.each(["notes.md", "NOTES.MD", "notes.markdown"])(
    "types %s as Markdown",
    async (name) => {
      const { mimeTypeForUpload } = await import("./media-upload.js");

      expect(mimeTypeForUpload(name)).toBe("text/markdown");
    },
  );
});

describe("attachmentFromUpload", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "production";
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("builds the attachment from what the upload recorded", async () => {
    uploadStore.get.mockResolvedValue({
      filename: "abc.pdf",
      originalName: "invoice.pdf",
      mimeType: "application/pdf",
      size: 2048,
      url: "https://cdn.builder.io/o/assets/abc",
      createdAt: 1,
    });
    const { attachmentFromUpload } = await import("./media-upload.js");

    await expect(
      attachmentFromUpload("owner@example.com", {
        filename: "abc.pdf",
        mimeType: "text/html",
      }),
    ).resolves.toEqual({
      id: "abc.pdf",
      filename: "abc.pdf",
      originalName: "invoice.pdf",
      mimeType: "application/pdf",
      size: 2048,
      url: "https://cdn.builder.io/o/assets/abc",
    });
    expect(uploadStore.get).toHaveBeenCalledWith(
      "owner@example.com",
      "abc.pdf",
    );
  });

  it("finds nothing for a file this owner never uploaded", async () => {
    uploadStore.get.mockResolvedValue(null);
    const { attachmentFromUpload } = await import("./media-upload.js");

    await expect(
      attachmentFromUpload("owner@example.com", { filename: "other.pdf" }),
    ).resolves.toBeNull();
  });

  it.each(["../secrets.env", "a/b.pdf", "a\\b.pdf"])(
    "refuses the path %s without looking it up",
    async (filename) => {
      const { attachmentFromUpload } = await import("./media-upload.js");

      await expect(
        attachmentFromUpload("owner@example.com", { filename }),
      ).resolves.toBeNull();
      expect(uploadStore.get).not.toHaveBeenCalled();
    },
  );
});
