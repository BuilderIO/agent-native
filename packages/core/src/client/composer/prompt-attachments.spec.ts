// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  escapePromptAttachmentAttribute,
  formatPromptWithAttachments,
  isInlineableAgentPromptFile,
  readAgentPromptAttachment,
} from "./prompt-attachments.js";

describe("prompt attachment helpers", () => {
  it("inlines readable text files up to the configured limit", async () => {
    const file = new File(["hello"], "notes.md", {
      type: "text/markdown",
    });

    const attachment = await readAgentPromptAttachment(file);

    expect(isInlineableAgentPromptFile(file)).toBe(true);
    expect(attachment).toEqual({
      name: "notes.md",
      type: "text/markdown",
      size: 5,
      text: "hello",
    });
  });

  it("falls back to filename metadata for oversized text files", async () => {
    const file = new File(["hello"], "notes.md", {
      type: "text/markdown",
    });

    const attachment = await readAgentPromptAttachment(file, {
      maxInlineTextChars: 2,
    });

    expect(attachment).toEqual({
      name: "notes.md",
      type: "text/markdown",
      size: 5,
    });
  });

  it("inlines small image files as data URLs", async () => {
    const file = new File(["fake image"], "screenshot.png", {
      type: "image/png",
    });

    const attachment = await readAgentPromptAttachment(file);

    expect(attachment.name).toBe("screenshot.png");
    expect(attachment.type).toBe("image/png");
    expect(attachment.dataUrl).toContain("data:image/png;base64,");
  });

  it("formats attachments with escaped XML attributes", () => {
    const formatted = formatPromptWithAttachments("Review this", [
      {
        name: 'bad"name&.ts',
        type: "text/plain",
        size: 12,
        text: "const x = 1;",
      },
      {
        name: "shot.png",
        type: "image/png",
        size: 3,
        dataUrl: "data:image/png;base64,abc",
      },
    ]);

    expect(escapePromptAttachmentAttribute('a&"b')).toBe("a&amp;&quot;b");
    expect(formatted).toContain("Attached context:");
    expect(formatted).toContain('name="bad&quot;name&amp;.ts"');
    expect(formatted).toContain("<attached-file");
    expect(formatted).toContain("<attached-image");
    expect(formatted).toContain("data:image/png;base64,abc");
  });
});
