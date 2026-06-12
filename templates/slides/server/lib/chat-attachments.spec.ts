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

  it("saves image attachments from chat as slide reference uploads", async () => {
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
  });

  it("keeps unsupported attachments out of the slides upload context", async () => {
    const result = await prepareSlidesChatAttachments({
      ownerEmail: "adam@builder.io",
      message: "use this file",
      attachments: [
        {
          type: "image",
          name: "vector.svg",
          contentType: "image/svg+xml",
          data: "data:image/svg+xml;base64,PHN2Zy8+",
        },
      ],
    });

    expect(saveUploadedReferenceFileMock).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });
});
