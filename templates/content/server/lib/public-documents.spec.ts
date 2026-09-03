import { describe, expect, it } from "vitest";

import {
  buildPublicDocumentPromptContext,
  PUBLIC_DOCUMENT_CONTEXT_EXCERPT_CHARS,
} from "./public-documents";

describe("public document prompt context", () => {
  it("keeps small documents complete", () => {
    const context = buildPublicDocumentPromptContext({
      id: "doc-small",
      title: "Small document",
      content: "# Overview\n\nEverything the agent needs.",
      updatedAt: "2026-07-11T12:00:00.000Z",
    });

    expect(context).toContain("Everything the agent needs.");
    expect(context).toContain("The complete document fits in this context");
    expect(context).not.toContain("middle omitted");
  });

  it("bounds large documents and gives an explicit full-read action", () => {
    const content = `START-${"a".repeat(4_000)}-${"z".repeat(4_000)}-END`;
    const context = buildPublicDocumentPromptContext({
      id: "doc-large",
      title: "Large document",
      content,
      updatedAt: "2026-07-11T12:00:00.000Z",
    });

    expect(context).toContain("START-");
    expect(context).toContain("-END");
    expect(context).toContain("middle omitted from initial context");
    expect(context).toContain("call `get-document`");
    expect(context).toContain('`id: "doc-large"`');
    expect(context).not.toContain(content);
    expect(context.length).toBeLessThan(
      PUBLIC_DOCUMENT_CONTEXT_EXCERPT_CHARS + 1_000,
    );
  });
});
