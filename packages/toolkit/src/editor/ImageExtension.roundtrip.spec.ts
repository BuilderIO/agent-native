// @vitest-environment happy-dom

import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { createSharedEditorExtensions } from "./extensions.js";

/**
 * GFM image round-trip for the SHARED block-level image node.
 *
 * Plans turn on `features.image` and rely on the image serializing to standard
 * markdown image syntax (`![alt](src)`) so plan blocks stay source-syncable and
 * byte-stable. The shared image node is built on `@tiptap/extension-image` (a
 * node named `image`), so tiptap-markdown serializes it through its built-in
 * `defaultMarkdownSerializer.nodes.image` fallback — NO custom `<img width>`
 * HTML override (that would break the GFM `html:false` contract).
 *
 * This mounts an `Editor` from the same `createSharedEditorExtensions` factory
 * the editor component uses, with `features.image: true` (the plan config), and
 * pins:
 *   - markdown `![alt](src)` parses to an `image` node and re-serializes
 *     byte-identically, and
 *   - a programmatically inserted image node serializes to `![alt](src)`.
 */

function buildEditor(content: string): Editor {
  return new Editor({
    element: document.createElement("div"),
    extensions: createSharedEditorExtensions({
      dialect: "gfm",
      features: { image: true },
    }),
    content,
  });
}

function getMarkdown(editor: Editor): string {
  const storage = editor.storage as unknown as {
    markdown?: { getMarkdown?: () => string };
  };
  return storage.markdown?.getMarkdown?.() ?? "";
}

function roundTrip(markdown: string): string {
  const editor = buildEditor(markdown);
  try {
    return getMarkdown(editor);
  } finally {
    editor.destroy();
  }
}

describe("shared image block — GFM markdown round-trip", () => {
  it("round-trips a standalone image (byte-stable)", () => {
    expect(roundTrip("![A cat](https://cdn.example.com/cat.png)")).toBe(
      "![A cat](https://cdn.example.com/cat.png)",
    );
  });

  it("round-trips an image with no alt text", () => {
    expect(roundTrip("![](https://cdn.example.com/y.png)")).toBe(
      "![](https://cdn.example.com/y.png)",
    );
  });

  it("round-trips an image embedded mid-body with a following paragraph (byte-stable)", () => {
    // The shared node's block-aware markdown serializer calls `closeBlock`, so
    // an image immediately followed by a paragraph keeps its blank-line
    // separator — byte-stable, unlike tiptap-markdown's inline default.
    const body = [
      "# Title",
      "",
      "Intro paragraph.",
      "",
      "![diagram](https://cdn.example.com/d.png)",
      "",
      "Closing paragraph.",
    ].join("\n");
    expect(roundTrip(body)).toBe(body);
  });

  it("round-trips an image as the final block (byte-stable)", () => {
    const body = [
      "# Title",
      "",
      "Intro paragraph.",
      "",
      "![diagram](https://cdn.example.com/d.png)",
    ].join("\n");
    expect(roundTrip(body)).toBe(body);
  });

  it("parses `![alt](src)` markdown into an `image` node", () => {
    const editor = buildEditor("![A cat](https://cdn.example.com/cat.png)");
    try {
      const json = editor.getJSON();
      const flat = JSON.stringify(json);
      expect(flat).toContain('"type":"image"');
      expect(flat).toContain("https://cdn.example.com/cat.png");
    } finally {
      editor.destroy();
    }
  });

  it("serializes a programmatically inserted image node to `![alt](src)`", () => {
    const editor = buildEditor("");
    try {
      editor.commands.setImage({
        src: "https://cdn.example.com/x.png",
        alt: "X",
      });
      expect(getMarkdown(editor)).toBe("![X](https://cdn.example.com/x.png)");
    } finally {
      editor.destroy();
    }
  });
});
