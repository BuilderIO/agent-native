// @vitest-environment happy-dom

import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { createSharedEditorExtensions } from "./extensions.js";


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
