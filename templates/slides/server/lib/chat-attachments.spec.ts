import { beforeEach, describe, expect, it, vi } from "vitest";

const saveUploadedReferenceFileMock = vi.hoisted(() => vi.fn());

vi.mock("../handlers/uploads.js", () => ({
  saveUploadedReferenceFile: saveUploadedReferenceFileMock,
}));

import { prepareSlidesChatAttachments } from "./chat-attachments";

describe("prepareSlidesChatAttachments", () => {
  beforeEach(() => {
    saveUploadedReferenceFileMock.mockReset();
  });

  it("keeps raw image data when storage returns an embeddable URL", async () => {
    saveUploadedReferenceFileMock.mockResolvedValue({
      path: "data/uploads/user/editor-ai.jpeg",
      url: "https://cdn.example.com/editor-ai.jpeg",
      originalName: "editor-ai.jpeg",
      filename: "stored.jpeg",
      type: "image/jpeg",
      size: 4,
    });

    const result = await prepareSlidesChatAttachments({
      ownerEmail: "adam@builder.io",
      message: "put this image into the current slide",
      attachments: [
        {
          type: "image",
          name: "editor-ai.jpeg",
          contentType: "image/jpeg",
          data: "data:image/jpeg;base64,/9j/AA==",
        },
      ],
    });

    expect(saveUploadedReferenceFileMock).toHaveBeenCalledTimes(1);
    expect(saveUploadedReferenceFileMock).toHaveBeenCalledWith({
      email: "adam@builder.io",
      originalName: "editor-ai.jpeg",
      data: Buffer.from([0xff, 0xd8, 0xff, 0x00]),
      type: "image/jpeg",
    });
    expect(result?.message).toContain("<slides-chat-attachments>");
    expect(result?.message).toContain("editor-ai.jpeg");
    expect(result?.message).toContain(
      "embeddable URL: https://cdn.example.com/editor-ai.jpeg",
    );
    expect(result?.message).toContain("PDF/PPTX/DOCX/FIG/image");
    expect(result?.attachments?.[0]?.data).toBe(
      "data:image/jpeg;base64,/9j/AA==",
    );
    expect((result?.attachments?.[0] as any)?.url).toBe(
      "https://cdn.example.com/editor-ai.jpeg",
    );
    expect((result?.attachments?.[0] as any)?.slidesUploadPath).toBe(
      "data/uploads/user/editor-ai.jpeg",
    );
  });

  it("keeps raw raster image data when storage returns no embeddable URL", async () => {
    saveUploadedReferenceFileMock.mockResolvedValue({
      path: "data/uploads/user/reference.png",
      originalName: "reference.png",
      filename: "stored.png",
      type: "image/png",
      size: 4,
    });

    const result = await prepareSlidesChatAttachments({
      ownerEmail: "adam@builder.io",
      message: "use this visual reference",
      attachments: [
        {
          type: "image",
          name: "reference.png",
          contentType: "image/png",
          data: "data:image/png;base64,iVBORw0KGgo=",
        },
      ],
    });

    expect(saveUploadedReferenceFileMock).toHaveBeenCalledTimes(1);
    expect(result?.message).toContain("reference.png");
    expect(result?.message).toContain("data/uploads/user/reference.png");
    expect(result?.message).not.toContain("embeddable URL:");
    expect(result?.attachments?.[0]?.data).toBe(
      "data:image/png;base64,iVBORw0KGgo=",
    );
    expect((result?.attachments?.[0] as any)?.url).toBeUndefined();
    expect((result?.attachments?.[0] as any)?.slidesUploadPath).toBe(
      "data/uploads/user/reference.png",
    );
  });

  it("keeps raw image data when storage returns no embeddable URL", async () => {
    saveUploadedReferenceFileMock.mockResolvedValue({
      path: "data/uploads/user/vector.svg",
      originalName: "vector.svg",
      filename: "stored.svg",
      type: "image/svg+xml",
      size: 6,
    });

    const result = await prepareSlidesChatAttachments({
      ownerEmail: "adam@builder.io",
      message: "use this logo",
      attachments: [
        {
          type: "image",
          name: "vector.svg",
          contentType: "image/svg+xml",
          data: "data:image/svg+xml;base64,PHN2Zy8+",
        },
      ],
    });

    expect(saveUploadedReferenceFileMock).toHaveBeenCalledTimes(1);
    expect(saveUploadedReferenceFileMock).toHaveBeenCalledWith({
      email: "adam@builder.io",
      originalName: "vector.svg",
      data: Buffer.from("<svg/>"),
      type: "image/svg+xml",
    });
    expect(result?.message).toContain("vector.svg");
    expect(result?.message).toContain("data/uploads/user/vector.svg");
    expect(result?.attachments?.[0]?.data).toBe(
      "data:image/svg+xml;base64,PHN2Zy8+",
    );
    expect((result?.attachments?.[0] as any)?.slidesUploadPath).toBe(
      "data/uploads/user/vector.svg",
    );
  });

  it("strips raw PDF data after saving it as a Slides reference upload", async () => {
    saveUploadedReferenceFileMock.mockResolvedValue({
      path: "data/uploads/user/source.pdf",
      originalName: "source.pdf",
      filename: "stored.pdf",
      type: "application/pdf",
      size: 12,
    });

    const result = await prepareSlidesChatAttachments({
      ownerEmail: "adam@builder.io",
      message: "recreate this deck",
      attachments: [
        {
          type: "file",
          name: "source.pdf",
          contentType: "application/pdf",
          data: "data:application/pdf;base64,JVBERi0x",
        },
      ],
    });

    expect(saveUploadedReferenceFileMock).toHaveBeenCalledTimes(1);
    expect(result?.message).toContain("data/uploads/user/source.pdf");
    expect(result?.attachments?.[0]?.data).toBeUndefined();
    expect((result?.attachments?.[0] as any)?.slidesUploadPath).toBe(
      "data/uploads/user/source.pdf",
    );
  });

  it("keeps unsupported attachments out of the slides upload context", async () => {
    const result = await prepareSlidesChatAttachments({
      ownerEmail: "adam@builder.io",
      message: "use this file",
      attachments: [
        {
          type: "file",
          name: "clip.mov",
          contentType: "video/quicktime",
          data: "data:video/quicktime;base64,AAAA",
        },
      ],
    });

    expect(saveUploadedReferenceFileMock).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });
});
