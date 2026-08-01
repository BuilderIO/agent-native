import { describe, expect, it } from "vitest";

import type { UploadedFile } from "@/components/editor/PromptDialog";

import {
  designTemplateRefinementDirectives,
  formatUploadedFileContext,
} from "./generation-prompt-directives";

const upload = (overrides: Partial<UploadedFile>): UploadedFile => ({
  path: "/uploads/spec.pdf",
  originalName: "spec.pdf",
  filename: "spec.pdf",
  type: "application/pdf",
  size: 2048,
  ...overrides,
});

describe("formatUploadedFileContext", () => {
  it("distinguishes an unreadable file from one that carries no text", () => {
    const unreadable = formatUploadedFileContext([
      upload({ textExtractionError: "pdf-parse unavailable in this runtime" }),
    ]);
    const empty = formatUploadedFileContext([upload({})]);

    expect(unreadable).toContain("Text could not be extracted");
    expect(unreadable).toContain("pdf-parse unavailable in this runtime");
    expect(empty).not.toContain("Text could not be extracted");
    expect(unreadable).not.toBe(empty);
  });

  it("prefers extracted text over the failure line", () => {
    const context = formatUploadedFileContext([
      upload({ textContent: "hello", textExtractionError: "stale" }),
    ]);

    expect(context).toContain("Extracted text:\nhello");
    expect(context).not.toContain("Text could not be extracted");
  });
});

describe("designTemplateRefinementDirectives", () => {
  it("uses copy-first editing instructions without a positive fresh-generation directive", () => {
    const directives = designTemplateRefinementDirectives(
      "design-1",
      "template-1",
      "system-1",
    );
    const text = directives.join("\n");

    expect(text).toContain("get-design-snapshot");
    expect(text).toContain("edit-design");
    expect(text).toContain("Do not call `generate-design`");
    expect(text).not.toContain("When calling `generate-design`");
    expect(text).not.toContain("Use the `generate-design");
  });
});
