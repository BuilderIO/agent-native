// @vitest-environment happy-dom

import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { createRichMarkdownExtensions } from "./RichMarkdownEditor.js";


function roundTrip(markdown: string): string {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: createRichMarkdownExtensions({ dialect: "gfm" }),
    content: markdown,
  });
  try {
    const storage = editor.storage as unknown as {
      markdown?: { getMarkdown?: () => string };
    };
    return storage.markdown?.getMarkdown?.() ?? "";
  } finally {
    editor.destroy();
  }
}

function expectStable(markdown: string): void {
  expect(roundTrip(markdown)).toBe(markdown);
}

function expectNormalizesTo(input: string, normalized: string): void {
  expect(roundTrip(input)).toBe(normalized);
  expect(normalized).not.toBe(input);
}

describe("RichMarkdownEditor markdown round-trip", () => {
  describe("byte-stable cases", () => {
    it("headings H1-H4 (ATX)", () => {
      expectStable("# Heading 1");
      expectStable("## Heading 2");
      expectStable("### Heading 3");
      expectStable("#### Heading 4");
    });

    it("paragraphs", () => {
      expectStable("A single plain paragraph.");
      expectStable("First paragraph.\n\nSecond paragraph.");
    });

    it("bold and inline code marks", () => {
      expectStable("Text with **bold** words.");
      expectStable("Text with `inline code` words.");
      expectStable("Mixed **bold** and `code` together.");
    });

    it("bulleted list (tight)", () => {
      expectStable("- One\n- Two\n- Three");
    });

    it("numbered list (tight)", () => {
      expectStable("1. One\n2. Two\n3. Three");
    });

    it("nested bulleted list", () => {
      expectStable("- One\n  - Nested A\n  - Nested B\n- Two");
    });

    it("a single task item", () => {
      expectStable("- [ ] Todo item");
      expectStable("- [x] Done item");
    });

    it("blockquote", () => {
      expectStable("> A quoted line.");
    });

    it("fenced code block with a language", () => {
      expectStable("```ts\nconst x: number = 1;\n```");
    });

    it("links", () => {
      expectStable("See [the docs](https://example.com/docs) for details.");
    });

    it("horizontal rule", () => {
      expectStable("Above.\n\n---\n\nBelow.");
    });

    it("GFM pipe table when followed by more content", () => {
      expectStable(
        [
          "Intro paragraph.",
          "",
          "| Name | Status |",
          "| --- | --- |",
          "| Alpha | Done |",
          "| Beta | Open |",
          "",
          "Closing paragraph.",
        ].join("\n"),
      );
    });

    it("a representative mixed plan body (no italics, table not last)", () => {
      expectStable(
        [
          "# Project Plan",
          "",
          "## Overview",
          "",
          "This plan covers the **rollout** of the new flow.",
          "",
          "## Notes",
          "",
          "See [the brief](https://example.com/brief) and run `pnpm test`.",
          "",
          "```ts",
          "const ready = true;",
          "```",
        ].join("\n"),
      );
    });
  });

  describe("pinned-lossy cases (inherent to tiptap-markdown 0.9.0)", () => {
    it("italic: underscore markers normalize to asterisks", () => {
      expectNormalizesTo(
        "Text with _italic_ words.",
        "Text with *italic* words.",
      );
      expectStable("Text with *italic* words.");
    });

    it("multi-item task lists serialize loose (blank line between items)", () => {
      expectNormalizesTo(
        "- [ ] Todo item\n- [x] Done item",
        "- [ ] Todo item\n\n- [x] Done item",
      );
    });

    it("nested task list also serializes loose", () => {
      expectNormalizesTo(
        "- [ ] parent\n  - [x] child",
        "- [ ] parent\n\n  - [x] child",
      );
    });

    it("a table as the LAST block gains a trailing newline", () => {
      expectNormalizesTo(
        [
          "| Name | Status |",
          "| --- | --- |",
          "| Alpha | Done |",
          "| Beta | Open |",
        ].join("\n"),
        [
          "| Name | Status |",
          "| --- | --- |",
          "| Alpha | Done |",
          "| Beta | Open |",
          "",
        ].join("\n"),
      );
    });
  });

  describe("intentional normalizations (desired, GFM-canonical)", () => {
    it("`*` bullet markers normalize to `-` per bulletListMarker config", () => {
      expectNormalizesTo("* One\n* Two", "- One\n- Two");
      expectNormalizesTo("+ One\n+ Two", "- One\n- Two");
    });
  });
});
