// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import { preparePromptComposerAgentHandoff } from "./prepare-prompt-composer-agent-handoff.js";

describe("prompt composer agent handoff", () => {
  it.each([[3 * 1024 * 1024], [2 * 1024 * 1024, 2 * 1024 * 1024]])(
    "rejects oversized raw files before reading any",
    async (...sizes) => {
      const files = sizes.map((size, index) => {
        const file = new File(["small"], `${index}.txt`);
        Object.defineProperty(file, "size", { value: size });
        return file;
      });
      const read = vi.spyOn(FileReader.prototype, "readAsDataURL");
      try {
        await expect(
          preparePromptComposerAgentHandoff(files, {}, "Upload failed"),
        ).rejects.toMatchObject({
          code: "upload_too_large",
          cause: { code: "upload_too_large" },
        });
        expect(read).not.toHaveBeenCalled();
      } finally {
        read.mockRestore();
      }
    },
  );
  it("preserves raw file bytes once and durable attachment URLs", async () => {
    const file = new File(["review content"], "review.txt", {
      type: "text/plain",
    });
    const result = await preparePromptComposerAgentHandoff(
      [file],
      {
        attachments: [
          { file, name: file.name },
          {
            name: "saved.pdf",
            content: [
              {
                type: "file",
                url: "https://example.test/saved.pdf",
                mimeType: "application/pdf",
              },
            ],
          },
        ],
      },
      "Localized upload failure",
    );
    expect(result.attachments).toEqual([
      {
        type: "file",
        name: "saved.pdf",
        url: "https://example.test/saved.pdf",
        contentType: "application/pdf",
      },
      {
        type: "file",
        name: "review.txt",
        contentType: "text/plain",
        data: "data:text/plain;base64,cmV2aWV3IGNvbnRlbnQ=",
      },
    ]);
  });
  it("preserves orphan files and prefers uploaded content over retained raw files", async () => {
    const file = new File(["context"], "context.txt", { type: "text/plain" });
    const orphan = await preparePromptComposerAgentHandoff(
      [],
      { attachments: [{ file, name: file.name }] },
      "Upload failed",
    );
    expect(orphan.attachments?.[0]).toMatchObject({
      name: "context.txt",
      data: "data:text/plain;base64,Y29udGV4dA==",
    });
    const uploaded = await preparePromptComposerAgentHandoff(
      [file],
      {
        attachments: [
          {
            file,
            name: file.name,
            content: [
              { type: "file", url: "https://example.test/context.txt" },
            ],
          },
        ],
      },
      "Upload failed",
    );
    expect(uploaded.attachments).toEqual([
      {
        type: "file",
        name: "context.txt",
        url: "https://example.test/context.txt",
        contentType: undefined,
      },
    ]);
  });
  it("preserves trusted HTTP storage references without reading the raw file", async () => {
    const file = new File(["small"], "large.txt");
    Object.defineProperty(file, "size", { value: 100 * 1024 * 1024 });
    const read = vi.spyOn(FileReader.prototype, "readAsDataURL");
    try {
      const result = await preparePromptComposerAgentHandoff(
        [file],
        {
          attachments: [
            {
              file,
              name: file.name,
              content: [
                { type: "file", url: "http://127.0.0.1:5203/bucket/file.txt" },
              ],
            },
          ],
        },
        "Upload failed",
      );
      expect(result.attachments?.[0]?.url).toBe(
        "http://127.0.0.1:5203/bucket/file.txt",
      );
      expect(read).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
    }
  });
  it("rejects unreadable descriptors rather than submitting without selected context", async () => {
    await expect(
      preparePromptComposerAgentHandoff(
        [],
        {
          attachments: [
            {
              name: "missing",
              content: [{ type: "file", url: "blob:unavailable" }],
            },
          ],
        },
        "Localized upload failure",
      ),
    ).rejects.toThrow("Localized upload failure");
  });
});
