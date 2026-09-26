import { describe, expect, it } from "vitest";

import { SLIDES_REFERENCE_FILE_ACCEPT } from "../../shared/upload-types";
import { createSlidesPromptAttachmentAdapter } from "./prompt-attachment-adapter";

describe("Slides prompt attachment adapter", () => {
  const adapter = createSlidesPromptAttachmentAdapter();

  it("matches the Slides reference upload allowlist without HTML", () => {
    expect(adapter.accept).toBe(SLIDES_REFERENCE_FILE_ACCEPT);
    expect(adapter.accept).toContain(".pdf");
    expect(adapter.accept).toContain(".pptx");
    expect(adapter.accept).not.toContain(".html");
    expect(adapter.accept).not.toContain(".htm");
  });

  it("stages a file without changing its bytes and gives duplicate names distinct ids", async () => {
    const firstFile = new File(["first"], "brand.pdf", {
      type: "application/pdf",
    });
    const secondFile = new File(["second"], "brand.pdf", {
      type: "application/pdf",
    });

    const first = await adapter.add({ file: firstFile });
    const second = await adapter.add({ file: secondFile });

    expect(first).toMatchObject({
      file: firstFile,
      name: firstFile.name,
      type: "document",
      status: { type: "requires-action" },
    });
    expect(first.id).not.toBe(second.id);
  });
});
