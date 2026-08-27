import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

const saveUploadedReferenceFileMock = vi.hoisted(() => vi.fn());

vi.mock("../handlers/uploads.js", () => ({
  saveUploadedReferenceFile: saveUploadedReferenceFileMock,
}));

import {
  buildSlidesDeckGenerationContext,
  prepareSlidesChatAttachments,
} from "./chat-attachments";

const agentChatPlugin = readFileSync(
  new URL("../plugins/agent-chat.ts", import.meta.url),
  "utf8",
);

describe("buildSlidesDeckGenerationContext", () => {
  it("keeps attached source files on the native Slides workflow", () => {
    expect(agentChatPlugin).toContain("Attached-source rule");
    expect(agentChatPlugin).toContain(
      "not an implicit request for the Assets app",
    );
    expect(agentChatPlugin).toContain(
      "use import-file with the persisted file path",
    );
    expect(agentChatPlugin).toContain("Do not call Assets through call-agent");
  });

  it("preserves the original brief and reference handles for follow-ups", () => {
    const context = buildSlidesDeckGenerationContext({
      originalPrompt: "Turn this outline into a dark theme deck",
      mode: "source-preserving",
      targetSlideCount: 6,
      designSystemId: "ds-1",
      files: [
        {
          originalName: "outline.png",
          path: "data/uploads/user/outline.png",
          url: "https://cdn.example.com/outline.png",
        },
      ],
    });

    expect(context).toContain(
      "Original brief: Turn this outline into a dark theme deck",
    );
    expect(context).toContain("Target slide count: 6");
    expect(context).toContain("path: data/uploads/user/outline.png");
    expect(context).toContain("URL: https://cdn.example.com/outline.png");
    expect(context).toContain("Re-open visual references before editing");
  });

  it("does not manufacture continuation context without an original brief", () => {
    expect(buildSlidesDeckGenerationContext({ files: [] })).toBeNull();
  });
});

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

  it("strips oversized inline image data while retaining the saved URL", async () => {
    saveUploadedReferenceFileMock.mockResolvedValue({
      path: "data/uploads/user/large-reference.jpeg",
      url: "https://cdn.example.com/large-reference.jpeg",
      originalName: "large-reference.jpeg",
      filename: "stored.jpeg",
      type: "image/jpeg",
      size: 10 * 1024 * 1024 + 1,
    });
    const data = `data:image/jpeg;base64,${Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64")}`;

    const result = await prepareSlidesChatAttachments({
      ownerEmail: "adam@builder.io",
      message: "analyze this screenshot",
      attachments: [
        {
          type: "image",
          name: "large-reference.jpeg",
          contentType: "image/jpeg",
          data,
        },
      ],
    });

    expect(saveUploadedReferenceFileMock).toHaveBeenCalledTimes(1);
    expect(result?.attachments?.[0]?.data).toBeUndefined();
    expect((result?.attachments?.[0] as any)?.url).toBe(
      "https://cdn.example.com/large-reference.jpeg",
    );
    expect((result?.attachments?.[0] as any)?.slidesUploadPath).toBe(
      "data/uploads/user/large-reference.jpeg",
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
    expect(result?.message).toContain("NO embeddable URL");
    expect(result?.message).toContain("Do not silently skip these images");
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

  it("keeps raw PDF data for the shared durable upload boundary", async () => {
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
    expect(result?.attachments?.[0]?.data).toBe(
      "data:application/pdf;base64,JVBERi0x",
    );
    expect((result?.attachments?.[0] as any)?.slidesUploadPath).toBe(
      "data/uploads/user/source.pdf",
    );
  });

  it("surfaces an already-hosted, url-only image instead of silently dropping it", async () => {
    // No inline `data` — this is the shape a pre-uploaded image takes once
    // `referenceImagePaths` merges into `images` and the framework wraps it
    // as an image content part with a plain URL
    // (packages/core/src/client/agent-chat-adapter.ts extractAttachmentsFromMessage).
    const result = await prepareSlidesChatAttachments({
      ownerEmail: "adam@builder.io",
      message: "add this image",
      attachments: [
        {
          type: "image",
          name: "editor-ai.jpeg",
          contentType: "image/jpeg",
          url: "https://cdn.example.com/editor-ai.jpeg",
        },
      ],
    });

    expect(saveUploadedReferenceFileMock).not.toHaveBeenCalled();
    expect(result?.message).toContain("<slides-chat-attachments>");
    expect(result?.message).toContain("editor-ai.jpeg");
    expect(result?.message).toContain(
      "embeddable URL: https://cdn.example.com/editor-ai.jpeg",
    );
    expect(result?.attachments?.[0]?.url).toBe(
      "https://cdn.example.com/editor-ai.jpeg",
    );
  });

  it("ignores an already-hosted attachment whose extension isn't a supported reference type", async () => {
    const result = await prepareSlidesChatAttachments({
      ownerEmail: "adam@builder.io",
      message: "use this clip",
      attachments: [
        {
          type: "file",
          name: "clip.mov",
          contentType: "video/quicktime",
          url: "https://cdn.example.com/clip.mov",
        },
      ],
    });

    expect(saveUploadedReferenceFileMock).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
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
