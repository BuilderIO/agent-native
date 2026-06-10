import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  preUploadAttachments,
  preUploadImageAttachments,
  isFileUploadProviderConfigured,
} from "./pre-upload-attachments.js";
import type { AgentChatAttachment } from "../agent/types.js";

const uploadFileMock = vi.hoisted(() => vi.fn());
const getActiveProviderMock = vi.hoisted(() => vi.fn());

vi.mock("./registry.js", () => ({
  uploadFile: uploadFileMock,
  getActiveFileUploadProvider: getActiveProviderMock,
}));

function makeImageAtt(
  overrides: Partial<AgentChatAttachment> = {},
): AgentChatAttachment {
  return {
    type: "image",
    name: "photo.png",
    contentType: "image/png",
    data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVQI12NgAAAAAgAB4iG8MwAAAABJRU5ErkJggg==",
    ...overrides,
  };
}

function makeFileAtt(
  overrides: Partial<AgentChatAttachment> = {},
): AgentChatAttachment {
  return {
    type: "file",
    name: "report.pdf",
    contentType: "application/pdf",
    data: "data:application/pdf;base64,JVBERi0x",
    ...overrides,
  };
}

describe("isFileUploadProviderConfigured", () => {
  it("returns true when getActiveFileUploadProvider returns a provider", () => {
    getActiveProviderMock.mockReturnValue({ id: "builder" });
    expect(isFileUploadProviderConfigured()).toBe(true);
  });

  it("returns false when no provider is configured", () => {
    getActiveProviderMock.mockReturnValue(null);
    expect(isFileUploadProviderConfigured()).toBe(false);
  });
});

describe("preUploadAttachments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getActiveProviderMock.mockReturnValue({ id: "builder" });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("uploads image attachments and injects the URL onto the attachment", async () => {
    uploadFileMock.mockResolvedValue({
      url: "https://cdn.example.com/photo.png",
      provider: "builder",
    });

    const att = makeImageAtt();
    const result = await preUploadAttachments({
      attachments: [att],
      ownerEmail: "user@example.com",
    });

    expect(result.uploaded).toHaveLength(1);
    expect(result.uploaded[0].url).toBe("https://cdn.example.com/photo.png");
    expect((att as any).url).toBe("https://cdn.example.com/photo.png");
    expect(result.injectedText).toContain("chat-image-attachment");
    expect(result.injectedText).toContain("https://cdn.example.com/photo.png");
  });

  it("uploads file attachments when includeFiles=true", async () => {
    uploadFileMock.mockResolvedValue({
      url: "https://cdn.example.com/report.pdf",
      provider: "builder",
    });

    const att = makeFileAtt();
    const result = await preUploadAttachments({
      attachments: [att],
      ownerEmail: "user@example.com",
      includeFiles: true,
    });

    expect(result.uploadedFiles).toHaveLength(1);
    expect(result.uploadedFiles[0].url).toBe(
      "https://cdn.example.com/report.pdf",
    );
    expect((att as any).url).toBe("https://cdn.example.com/report.pdf");
    expect(result.injectedText).toContain("chat-file-attachment");
  });

  it("does NOT upload file attachments when includeFiles=false (legacy behaviour)", async () => {
    uploadFileMock.mockResolvedValue({
      url: "https://cdn.example.com/report.pdf",
      provider: "builder",
    });

    const att = makeFileAtt();
    const result = await preUploadAttachments({
      attachments: [att],
      ownerEmail: "user@example.com",
      includeFiles: false,
    });

    expect(result.uploadedFiles).toHaveLength(0);
    expect(uploadFileMock).not.toHaveBeenCalled();
  });

  it("reuses an existing URL without re-uploading", async () => {
    const att = makeImageAtt();
    (att as any).url = "https://cdn.example.com/already-uploaded.png";
    (att as any).uploadProvider = "builder";

    const result = await preUploadAttachments({
      attachments: [att],
      ownerEmail: "user@example.com",
    });

    expect(uploadFileMock).not.toHaveBeenCalled();
    expect(result.uploaded[0].url).toBe(
      "https://cdn.example.com/already-uploaded.png",
    );
  });

  it("sets providerMissing=true and injects an error hint when uploadFile returns null for image", async () => {
    uploadFileMock.mockResolvedValue(null);

    const att = makeImageAtt();
    const result = await preUploadAttachments({
      attachments: [att],
      ownerEmail: "user@example.com",
    });

    expect(result.providerMissing).toBe(true);
    expect(result.injectedText).toContain("no file-upload provider");
  });

  it("does not crash when uploadFile throws; keeps base64 for that attachment", async () => {
    uploadFileMock.mockRejectedValue(new Error("network error"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const att = makeImageAtt();
    const result = await preUploadAttachments({
      attachments: [att],
      ownerEmail: "user@example.com",
    });

    expect(result.uploaded).toHaveLength(0);
    // The attachment should still be in the list so the model can see base64.
    expect(result.attachments).toContain(att);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("handles an empty attachment list gracefully", async () => {
    const result = await preUploadAttachments({
      attachments: [],
      ownerEmail: "user@example.com",
    });

    expect(result.uploaded).toHaveLength(0);
    expect(result.uploadedFiles).toHaveLength(0);
    expect(result.providerMissing).toBe(false);
    expect(result.injectedText).toBeNull();
    expect(uploadFileMock).not.toHaveBeenCalled();
  });
});

describe("preUploadImageAttachments (legacy shim)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getActiveProviderMock.mockReturnValue({ id: "builder" });
  });

  it("only uploads images, not files (includeFiles=false legacy behaviour)", async () => {
    uploadFileMock.mockResolvedValue({
      url: "https://cdn.example.com/photo.png",
      provider: "builder",
    });

    const imageAtt = makeImageAtt();
    const fileAtt = makeFileAtt();
    const result = await preUploadImageAttachments({
      attachments: [imageAtt, fileAtt],
      ownerEmail: "user@example.com",
    });

    // Image should be uploaded, file should not.
    expect(result.uploaded).toHaveLength(1);
    expect(result.uploadedFiles).toHaveLength(0);
    // uploadFile was called only for the image.
    expect(uploadFileMock).toHaveBeenCalledTimes(1);
  });
});
