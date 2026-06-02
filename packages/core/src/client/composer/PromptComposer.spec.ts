// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { buildPromptComposerSubmission } from "./PromptComposer.js";
import { AGENT_PROMPT_MAX_INLINE_IMAGE_BYTES } from "./prompt-attachments.js";

describe("buildPromptComposerSubmission", () => {
  it("inlines image-only submissions so standalone flows receive a prompt", async () => {
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
    expect(result.text).toContain(
      '<uploaded-image name="sketch.png" contentType="image/png">',
    );
    expect(result.text).toContain("data:image/png;base64,");
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

  it("does not inline oversized image-only submissions into the prompt", async () => {
    const file = new File(
      [new Uint8Array(AGENT_PROMPT_MAX_INLINE_IMAGE_BYTES + 1)],
      "large.png",
      { type: "image/png" },
    );

    const result = await buildPromptComposerSubmission({
      text: "",
      attachments: [
        {
          id: "large.png",
          name: "large.png",
          type: "image",
          file,
        },
      ],
    });

    expect(result.files).toEqual([file]);
    expect(result.text).toBe("");
  });
});
