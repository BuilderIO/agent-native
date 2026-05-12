// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { buildPromptComposerSubmission } from "./PromptComposer.js";

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
});
