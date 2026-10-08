// @vitest-environment happy-dom

import { serializeIconValue } from "@agent-native/core/icons";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";

import { NotionCallout } from "./extensions/NotionExtensions";

describe("NotionCallout static HTML", () => {
  it("keeps serialized icons in attributes without displaying their JSON as text", () => {
    const icon = serializeIconValue({
      version: 1,
      kind: "library",
      library: "tabler",
      name: "book",
      color: "blue",
    })!;
    const editor = new Editor({
      extensions: [StarterKit, NotionCallout],
      content: {
        type: "doc",
        content: [
          {
            type: "notionCallout",
            attrs: { icon },
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Read" }] },
            ],
          },
        ],
      },
    });
    try {
      const html = editor.getHTML();
      expect(html).toContain("data-notion-callout-icon");
      expect(html).toContain("Read");
      expect(html).toContain("data-icon=");
      expect(html).toContain('<div data-notion-callout-icon="true"></div>');
    } finally {
      editor.destroy();
    }
  });
});
