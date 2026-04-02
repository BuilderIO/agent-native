import { describe, expect, it } from "vitest";
import { parseNfmForEditor, normalizeNfmForStorage } from "./notion-markdown";

describe("parseNfmForEditor", () => {
  describe("empty-block handling", () => {
    it("converts <empty-block/> to visible &nbsp; paragraph", () => {
      const result = parseNfmForEditor(
        "text above\n<empty-block/>\ntext below",
      );
      expect(result).toContain("&nbsp;");
      expect(result).not.toContain("<empty-block/>");
    });

    it("handles multiple consecutive empty blocks", () => {
      const result = parseNfmForEditor(
        "above\n<empty-block/>\n<empty-block/>\nbelow",
      );
      const nbspCount = (result.match(/&nbsp;/g) || []).length;
      expect(nbspCount).toBe(2);
    });

    it("handles leading empty block", () => {
      const result = parseNfmForEditor("<empty-block/>\nfirst content");
      expect(result).toContain("&nbsp;");
    });

    it("handles empty-block with attributes", () => {
      const result = parseNfmForEditor('<empty-block id="x"/>');
      expect(result).not.toContain("<empty-block");
    });
  });

  describe("tab-indented plain text → blockquote", () => {
    it("converts single-tab indent to blockquote", () => {
      const result = parseNfmForEditor("parent\n\tchild");
      expect(result).toContain("> child");
      expect(result).not.toContain("\tchild");
    });

    it("converts double-tab indent to nested blockquote", () => {
      const result = parseNfmForEditor("parent\n\t\tgrandchild");
      expect(result).toContain("> > grandchild");
    });

    it("converts triple-tab indent to triply-nested blockquote", () => {
      const result = parseNfmForEditor("parent\n\t\t\tdeep");
      expect(result).toContain("> > > deep");
    });

    it("does NOT convert list items to blockquotes", () => {
      const result = parseNfmForEditor("\t- list item");
      expect(result).toContain("- list item");
      expect(result).not.toContain("> - list item");
    });

    it("does NOT convert numbered list items to blockquotes", () => {
      const result = parseNfmForEditor("\t1. numbered");
      expect(result).toContain("1. numbered");
      expect(result).not.toContain("> 1. numbered");
    });

    it("does NOT convert task items to blockquotes", () => {
      const result = parseNfmForEditor("\t- [ ] task");
      expect(result).toContain("- [ ] task");
    });
  });

  describe("tab-indented list items → space-indented", () => {
    it("uses 4-space indentation for nested bullet lists", () => {
      const result = parseNfmForEditor("- parent\n\t- child");
      expect(result).toContain("    - child");
    });

    it("uses 4-space indentation for nested numbered lists", () => {
      const result = parseNfmForEditor("1. parent\n\t1. child");
      expect(result).toContain("    1. child");
    });

    it("handles double-nested list items", () => {
      const result = parseNfmForEditor("- a\n\t- b\n\t\t- c");
      expect(result).toContain("        - c");
    });
  });

  describe("toggle (details) content conversion", () => {
    it("converts toggle content from NFM to HTML", () => {
      const input = [
        "<details>",
        "<summary>My Toggle</summary>",
        "\tSome content here",
        "</details>",
      ].join("\n");
      const result = parseNfmForEditor(input);
      expect(result).toContain("<details>");
      expect(result).toContain("<summary>My Toggle</summary>");
      // Base-level content inside toggle becomes <p>
      expect(result).toContain("<p>Some content here</p>");
      expect(result).toContain("</details>");
    });

    it("converts list items inside toggle to HTML lists", () => {
      const input = [
        "<details>",
        "<summary>Toggle</summary>",
        "\t- item 1",
        "\t- item 2",
        "</details>",
      ].join("\n");
      const result = parseNfmForEditor(input);
      expect(result).toContain("<ul>");
      expect(result).toContain("<li>");
    });

    it("handles nested indentation inside toggle", () => {
      const input = [
        "<details>",
        "<summary>Toggle</summary>",
        "\tparent text",
        "\t\tchild text",
        "</details>",
      ].join("\n");
      const result = parseNfmForEditor(input);
      expect(result).toContain("<blockquote>");
    });

    it("does not modify content outside toggle", () => {
      const input =
        "plain text\n<details>\n<summary>T</summary>\n\tcontent\n</details>\nmore text";
      const result = parseNfmForEditor(input);
      expect(result).toContain("plain text");
      expect(result).toContain("more text");
    });
  });

  describe("paragraph separation", () => {
    it("inserts blank line between consecutive plain text lines", () => {
      const result = parseNfmForEditor("line one\nline two");
      const lines = result.split("\n");
      const idx = lines.indexOf("line one");
      expect(lines[idx + 1]).toBe("");
    });

    it("does NOT insert blank line between list items", () => {
      const result = parseNfmForEditor("- a\n- b");
      expect(result).toBe("- a\n- b");
    });

    it("inserts blank line after blockquote before non-blockquote", () => {
      const result = parseNfmForEditor("parent\n\tchild\nnext paragraph");
      // blockquote (> child) should be followed by blank line before "next paragraph"
      expect(result).toMatch(/> child\n\nnext paragraph/);
    });

    it("inserts blank line before --- to prevent setext heading", () => {
      const result = parseNfmForEditor("text\n---\nmore");
      expect(result).toMatch(/text\n\n---/);
    });

    it("inserts blank line after </details>", () => {
      const input = "<details>\n<summary>T</summary>\n\tx\n</details>\nnext";
      const result = parseNfmForEditor(input);
      expect(result).toMatch(/<\/details>\n\nnext/);
    });
  });

  describe("code blocks are left untouched", () => {
    it("preserves indentation inside code fences", () => {
      const input = "```\n\tindented code\n\t\tmore\n```";
      const result = parseNfmForEditor(input);
      expect(result).toContain("\tindented code");
      expect(result).toContain("\t\tmore");
    });

    it("does not convert empty-blocks inside code", () => {
      const input = "```\n<empty-block/>\n```";
      const result = parseNfmForEditor(input);
      expect(result).toContain("<empty-block/>");
    });
  });

  describe("HTML containers are left untouched in pass 2", () => {
    it("does not rewrite content inside callout", () => {
      const input = "<callout>\n\tindented\n</callout>";
      const result = parseNfmForEditor(input);
      expect(result).toContain("\tindented");
    });
  });

  describe("mixed content", () => {
    it("handles heading followed by list followed by indented text", () => {
      const input = "## Heading\n- item\nplain\n\tindented";
      const result = parseNfmForEditor(input);
      expect(result).toContain("## Heading");
      expect(result).toContain("- item");
      expect(result).toContain("> indented");
    });

    it("handles empty input", () => {
      expect(parseNfmForEditor("")).toBe("");
    });

    it("handles input with only empty blocks", () => {
      const result = parseNfmForEditor(
        "<empty-block/>\n<empty-block/>\n<empty-block/>",
      );
      expect(result).not.toContain("<empty-block");
    });

    it("preserves markdown links in indented text", () => {
      const result = parseNfmForEditor("\t[link text](https://example.com)");
      // Link text should be in a blockquote, preserving the markdown
      expect(result).toContain("> [link text](https://example.com)");
    });
  });

  describe("round-trip stability", () => {
    it("preserves all content through conversion", () => {
      const nfm =
        "heading\n<empty-block/>\nparent\n\tchild\n- bullet\n\t- nested";
      const result = parseNfmForEditor(nfm);
      expect(result).toContain("heading");
      expect(result).toContain("parent");
      expect(result).toContain("child");
      expect(result).toContain("bullet");
      expect(result).toContain("nested");
      expect(result).not.toContain("<empty-block");
      expect(result).not.toMatch(/^\t/m);
    });

    it("preserves content structure through parse", () => {
      const nfm =
        "heading\n<empty-block/>\nparent\n\tchild\n- bullet\n\t- nested";
      const result = parseNfmForEditor(nfm);
      // All content should be present
      expect(result).toContain("heading");
      expect(result).toContain("parent");
      expect(result).toContain("child");
      expect(result).toContain("bullet");
      expect(result).toContain("nested");
      // NFM constructs should be gone
      expect(result).not.toContain("<empty-block");
      expect(result).not.toMatch(/^\t/m);
    });
  });
});
