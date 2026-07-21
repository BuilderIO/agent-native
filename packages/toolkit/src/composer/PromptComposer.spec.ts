// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { buildPromptComposerSubmission } from "./PromptComposer.js";

describe("buildPromptComposerSubmission", () => {
  it("passes images through files only — never inlines base64 into prompt text", async () => {
    // Images are passed to `files` for the host to process through the
    // attachment pipeline. They must NOT be inlined as base64 in `text`
    // (≈700K tokens per MB of image data).
    const file = new File(["fake image"], "sketch.png", {
      type: "image/png",
    });

    const result = await buildPromptComposerSubmission({
      text: "",
      attachments: [
        {
          id: "sketch.png",
          name: "sketch.png",
          type: "image",
          file,
        },
      ],
    });

    expect(result.files).toEqual([file]);
    // text must not contain any base64 data or uploaded-image markup
    expect(result.text).not.toContain("data:image");
    expect(result.text).not.toContain("<uploaded-image");
  });

  it("escapes inline attachment metadata in standalone submissions", async () => {
    const file = new File(["hello"], 'bad"name&.md', {
      type: "text/markdown",
    });

    const result = await buildPromptComposerSubmission({
      text: "Review this",
      attachments: [
        {
          id: "bad",
          name: file.name,
          type: "document",
          file,
        },
      ],
    });

    expect(result.text).toContain('name="bad&quot;name&amp;.md"');
    expect(result.text).not.toContain('name="bad"name&.md"');
  });

  it("does not include image data in prompt text regardless of file size", async () => {
    // Both small and large images stay in `files` only.
    const smallFile = new File(["small image"], "small.png", {
      type: "image/png",
    });
    const largeFile = new File([new Uint8Array(3 * 1024 * 1024)], "large.png", {
      type: "image/png",
    });

    for (const file of [smallFile, largeFile]) {
      const result = await buildPromptComposerSubmission({
        text: "",
        attachments: [{ id: file.name, name: file.name, type: "image", file }],
      });
      expect(result.files).toEqual([file]);
      expect(result.text).not.toContain("data:image");
    }
  });
});
