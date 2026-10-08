import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { createDesignPromptAttachmentAdapter } from "./prompt-attachment-adapter";
import { MAX_UPLOAD_BYTES } from "./upload-limits";

describe("Design host attachment adapter", () => {
  const adapter = createDesignPromptAttachmentAdapter("Attachment limit");
  const extensions = [
    ".html",
    ".css",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".json",
    ".txt",
    ".md",
    ".csv",
    ".pdf",
    ".docx",
    ".pptx",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
  ];

  it("keeps the exact backend supported extensions, including JavaScript and TypeScript", () => {
    expect(adapter.accept.split(",")).toEqual(extensions);
    const server = readFileSync(
      new URL("../../server/handlers/uploads.ts", import.meta.url),
      "utf8",
    );
    const allowlist = server.slice(
      server.indexOf("const ALLOWED_EXTENSIONS"),
      server.indexOf("function tenantUploadDir"),
    );
    expect(
      [...allowlist.matchAll(/"(\.[a-z]+)"/g)].map((match) => match[1]),
    ).toEqual(extensions);
  });

  it.each(extensions)(
    "stages %s files without consuming their text or changing original bytes",
    async (extension) => {
      const file = new File(["original"], `reference${extension}`, {
        type: "application/octet-stream",
      });
      const attachment = await adapter.add({ file });
      expect(attachment).toMatchObject({
        file,
        name: file.name,
        status: { type: "requires-action" },
      });
      expect(
        "content" in attachment ? attachment.content : undefined,
      ).toBeUndefined();
    },
  );

  it("accepts supported text between the generic 3MiB limit and the existing 4MiB host limit", async () => {
    const file = new File([new Uint8Array(MAX_UPLOAD_BYTES)], "large.tsx");
    await expect(adapter.add({ file })).resolves.toMatchObject({ file });
    await expect(
      adapter.add({
        file: new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], "large.tsx"),
      }),
    ).rejects.toThrow("Attachment limit");
  });

  it("retains original images for host compression and gives same-named files distinct runtime ids", async () => {
    const first = await adapter.add({ file: new File(["one"], "image.png") });
    const second = await adapter.add({ file: new File(["two"], "image.png") });
    expect(first).toMatchObject({ type: "image" });
    expect(first.id).not.toBe(second.id);
  });
});
