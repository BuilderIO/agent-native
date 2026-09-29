// @vitest-environment happy-dom

import type { JSONContent } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { gfmToProseJSON, proseJSONToGfm } from "./gfmDoc.js";

function once(markdown: string): string {
  return proseJSONToGfm(gfmToProseJSON(markdown));
}

function expectStableRoundTrip(markdown: string): void {
  const first = once(markdown);
  const second = once(first);
  expect(second).toBe(first);
}

function topLevelTypes(markdown: string): string[] {
  return gfmToProseJSON(markdown).map((node) => node.type ?? "");
}

function meaningfulTypes(markdown: string): string[] {
  const types = topLevelTypes(markdown);
  while (
    types.length > 1 &&
    types[types.length - 1] === "paragraph" &&
    isEmptyParagraph(gfmToProseJSON(markdown)[types.length - 1])
  ) {
    types.pop();
  }
  return types;
}

function isEmptyParagraph(node: JSONContent | undefined): boolean {
  return node?.type === "paragraph" && (node.content ?? []).length === 0;
}

const PROSE_CORPUS: Record<string, string> = {
  "heading 1": "# Heading 1",
  "heading 2": "## Heading 2",
  "heading 3": "### Heading 3",
  paragraph: "A plain paragraph of prose.",
  "bulleted list": "- One\n- Two\n- Three",
  "numbered list": "1. One\n2. Two\n3. Three",
  "task list": "- [ ] Todo item\n- [x] Done item",
  blockquote: "> A quoted line.",
  "fenced code block": "```ts\nconst x: number = 1;\n```",
  "inline marks": "Text with **bold**, *italic*, `code`, and a word.",
  link: "See [the docs](https://example.com/docs) for details.",
  table: [
    "| Name | Status |",
    "| --- | --- |",
    "| Alpha | Done |",
    "| Beta | Open |",
    "",
    "Trailing paragraph so the table is not the last block.",
  ].join("\n"),
  "mixed body": [
    "# Project Plan",
    "",
    "## Overview",
    "",
    "This plan covers the **rollout** of the new flow.",
    "",
    "- Step one",
    "- Step two",
    "",
    "> A note to remember.",
    "",
    "```ts",
    "const ready = true;",
    "```",
  ].join("\n"),
};

describe("gfmDoc GFM ↔ ProseMirror primitive", () => {
  describe("round-trip is stable (fixed point)", () => {
    for (const [name, markdown] of Object.entries(PROSE_CORPUS)) {
      it(`stabilizes: ${name}`, () => {
        expectStableRoundTrip(markdown);
      });
    }
  });

  describe("gfmToProseJSON produces expected node types", () => {
    it("headings carry their level", () => {
      expect(meaningfulTypes("# A\n\n## B\n\n### C")).toEqual([
        "heading",
        "heading",
        "heading",
      ]);
      const levels = gfmToProseJSON("# A\n\n## B\n\n### C")
        .filter((n) => n.type === "heading")
        .map((n) => n.attrs?.level);
      expect(levels).toEqual([1, 2, 3]);
    });

    it("paragraph", () => {
      expect(meaningfulTypes("Just text.")).toEqual(["paragraph"]);
    });

    it("bulleted list", () => {
      expect(meaningfulTypes("- a\n- b")).toEqual(["bulletList"]);
    });

    it("numbered list", () => {
      expect(meaningfulTypes("1. a\n2. b")).toEqual(["orderedList"]);
    });

    it("task list", () => {
      expect(meaningfulTypes("- [ ] a\n- [x] b")).toEqual(["taskList"]);
    });

    it("blockquote", () => {
      expect(meaningfulTypes("> quoted")).toEqual(["blockquote"]);
    });

    it("fenced code block keeps language", () => {
      const nodes = gfmToProseJSON("```ts\nconst x = 1;\n```");
      const code = nodes.find((n) => n.type === "codeBlock");
      expect(meaningfulTypes("```ts\nconst x = 1;\n```")).toEqual([
        "codeBlock",
      ]);
      expect(code?.attrs?.language).toBe("ts");
    });

    it("GFM pipe table", () => {
      expect(meaningfulTypes(["| H |", "| --- |", "| v |"].join("\n"))).toEqual(
        ["table"],
      );
    });

    it("inline marks land on the paragraph's text", () => {
      const nodes = gfmToProseJSON("Has **bold**, *italic*, `code`.");
      expect(nodes).toHaveLength(1);
      const para = nodes[0] as JSONContent;
      expect(para.type).toBe("paragraph");
      const markTypes = new Set(
        (para.content ?? []).flatMap((child) =>
          (child.marks ?? []).map((m) => m.type),
        ),
      );
      expect(markTypes.has("bold")).toBe(true);
      expect(markTypes.has("italic")).toBe(true);
      expect(markTypes.has("code")).toBe(true);
    });

    it("link mark carries the href", () => {
      const nodes = gfmToProseJSON("See [docs](https://example.com).");
      const para = nodes[0] as JSONContent;
      const linkMark = (para.content ?? [])
        .flatMap((child) => child.marks ?? [])
        .find((m) => m.type === "link");
      expect(linkMark?.attrs?.href).toBe("https://example.com");
    });
  });

  describe("runId attribute", () => {
    it("is omitted from serialized GFM markdown", () => {
      const nodes = gfmToProseJSON("A paragraph.");
      const stamped = nodes.map((n, i) =>
        i === 0
          ? { ...n, attrs: { ...(n.attrs ?? {}), runId: "block-123" } }
          : n,
      );
      const markdown = proseJSONToGfm(stamped);
      expect(markdown).toBe("A paragraph.");
      expect(markdown).not.toContain("block-123");
      expect(markdown).not.toContain("run-id");
    });

    it("survives a prose → JSON → prose round-trip when set", () => {
      const nodes = gfmToProseJSON("A paragraph.");
      const stamped = nodes.map((n, i) =>
        i === 0 ? { ...n, attrs: { ...(n.attrs ?? {}), runId: "block-9" } } : n,
      );
      const reparsed = gfmToProseJSON(proseJSONToGfm(stamped));
      expect(reparsed[0]?.type).toBe("paragraph");
      expect(reparsed[0]?.attrs?.runId ?? null).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("empty string yields a single empty paragraph", () => {
      const nodes = gfmToProseJSON("");
      expect(nodes).toHaveLength(1);
      expect(nodes[0]?.type).toBe("paragraph");
    });

    it("empty node array serializes to empty markdown", () => {
      expect(proseJSONToGfm([])).toBe("");
    });
  });
});
