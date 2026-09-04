// @vitest-environment happy-dom

import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { createRichMarkdownExtensions } from "./RichMarkdownEditor.js";

/**
 * Round-trip fidelity for the Plan rich-text editor.
 *
 * tiptap-markdown re-serializes the ENTIRE document on every edit. If
 * `serialize(parse(markdown)) !== markdown` for the markdown that plans
 * actually contain, then the FIRST edit of an existing block emits a fully
 * normalized version of text the user never touched — a noisy one-time git
 * diff plus an update-rich-text write that rewrites untouched prose.
 *
 * This suite mounts an `Editor` from the SAME extension factory the component
 * uses ({@link createRichMarkdownExtensions}) so the test and the component can
 * never disagree about the dialect, then pins the round-trip output for a
 * representative plan corpus. Cases fall into two buckets:
 *
 *   - byte-stable: `roundTrip(x) === x`. Asserted via `expectStable`.
 *   - pinned-lossy: tiptap-markdown 0.9.0 normalizes the input in a way that
 *     CANNOT be removed through the public `Markdown.configure` surface
 *     (the relevant internals — prosemirror-markdown's `em` serializer and the
 *     non-exported `MarkdownTightLists` extension — are not configurable). We
 *     are forbidden from reformatting/post-processing stored markdown to chase
 *     stability, so these are pinned to their ACTUAL normalized output via
 *     `expectNormalizesTo`. That keeps each normalization visible and
 *     regression-guarded instead of silently churning.
 *
 * The only lever we are allowed to pull is the tiptap-markdown
 * `Markdown.configure` options in the shared factory. The current config
 * (`bulletListMarker: "-"`, `tightLists: true`, `linkify: false`,
 * `breaks: false`) already minimizes normalization for everything below; the
 * remaining lossy cases are inherent to the library at this version.
 */

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

/** Asserts the markdown survives parse→serialize unchanged (byte-stable). */
function expectStable(markdown: string): void {
  expect(roundTrip(markdown)).toBe(markdown);
}

/**
 * Asserts an inherently-lossy case serializes to a KNOWN normalized form.
 * Pins the normalization so it stays visible and regression-guarded; also
 * guards that the case is genuinely lossy (otherwise it belongs in the
 * byte-stable bucket).
 */
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
      // A table in the middle of a body (the common case in a plan) is stable.
      // The trailing-newline normalization only happens when a table is the
      // very last block — see pinned-lossy cases below.
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
      // tiptap-markdown serializes the italic mark via prosemirror-markdown's
      // `defaultMarkdownSerializer.marks.em`, which hardcodes `*` open/close.
      // There is NO `Markdown.configure` option for the emphasis marker
      // (`bulletListMarker` only controls bullet lists), so `_x_` always
      // re-emits as `*x*`. Asterisk-delimited italics are already stable.
      expectNormalizesTo(
        "Text with _italic_ words.",
        "Text with *italic* words.",
      );
      expectStable("Text with *italic* words.");
    });

    it("multi-item task lists serialize loose (blank line between items)", () => {
      // tiptap-markdown's tight-list support (MarkdownTightLists) only
      // registers the `tight` attribute for `bulletList`/`orderedList`, never
      // `taskList`, and that extension is not exported for reconfiguration.
      // So task lists with 2+ items always gain a blank line between items.
      // A single task item (above) stays stable.
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
      // When a pipe table is the final block in the document the serializer
      // appends a trailing "\n". (Mid-body tables — see byte-stable cases —
      // do not.) Not removable via public config.
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
      // We deliberately keep bulletListMarker: "-" so all bullets converge on
      // the GFM-canonical dash. `*`/`+` bullets becoming `-` is intended.
      expectNormalizesTo("* One\n* Two", "- One\n- Two");
      expectNormalizesTo("+ One\n+ Two", "- One\n- Two");
    });
  });
});
