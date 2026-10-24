import { describe, expect, it } from "vitest";

import { normalizeCodeAgentPromptAttachments } from "./code-agent-prompt-attachments.js";

describe("normalizeCodeAgentPromptAttachments", () => {
  it("keeps the truncation length and read error the prompt needs", () => {
    expect(
      normalizeCodeAgentPromptAttachments([
        {
          name: "DESIGN.md",
          type: "text/markdown",
          size: 70_000,
          text: "# Design",
          totalChars: 70_000,
        },
        { name: "notes.md", readError: "not-utf8" },
        {
          name: "logo.svg",
          text: "<svg/>",
          dataUrl: "data:image/svg+xml;base64,PHN2Zy8+",
        },
      ]),
    ).toEqual([
      {
        name: "DESIGN.md",
        type: "text/markdown",
        size: 70_000,
        text: "# Design",
        totalChars: 70_000,
      },
      { name: "notes.md", readError: "not-utf8" },
      {
        name: "logo.svg",
        text: "<svg/>",
        dataUrl: "data:image/svg+xml;base64,PHN2Zy8+",
      },
    ]);
  });

  it("drops values the formatter does not understand", () => {
    expect(
      normalizeCodeAgentPromptAttachments([
        { name: "a.md", totalChars: "70000", readError: "exploded" },
        { name: "b.md", totalChars: -1 },
        { name: "" },
        "not an attachment",
      ]),
    ).toEqual([{ name: "a.md" }, { name: "b.md" }]);
  });
});
