// @vitest-environment happy-dom

import { Editor, getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import {
  parseNfmForEditor,
  serializeEditorToNfm,
} from "@shared/notion-markdown";
import {
  createVisualEditorExtensions,
  EmptyLineParagraph,
} from "./VisualEditor";
import { CodeBlock } from "./extensions/CodeBlockNode";

function createMarkdownEditor(content: string) {
  return new Editor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        paragraph: false,
      }),
      CodeBlock,
      EmptyLineParagraph,
      Markdown.configure({
        html: true,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: parseNfmForEditor(content),
  });
}

describe("VisualEditor markdown round-tripping", () => {
  it("preserves intentional empty paragraphs through the real TipTap serializer", () => {
    const editor = createMarkdownEditor("A\n<empty-block/>\n<empty-block/>\nB");

    try {
      const markdown = (editor.storage as any).markdown.getMarkdown();
      const stored = serializeEditorToNfm(markdown);
      expect(stored).toBe("A\n<empty-block/>\n<empty-block/>\nB");
    } finally {
      editor.destroy();
    }
  });

  it("does not parse Notion-pulled indented bullets as a code block", () => {
    const editor = createMarkdownEditor(
      [
        "michael onboarding",
        "\t- notion doc",
        "\t- access: amplitude, fullstory, sigma, jira",
      ].join("\n"),
    );

    try {
      const json = editor.getJSON();
      expect(JSON.stringify(json)).not.toContain('"codeBlock"');
      expect(JSON.stringify(json)).toContain('"bulletList"');
    } finally {
      editor.destroy();
    }
  });

  it("creates a collaborative empty doc without recursive block filling", () => {
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    const schema = getSchema(
      createVisualEditorExtensions({
        ydoc,
        localAwareness: awareness,
        user: { name: "Test User", color: "#60a5fa" },
      }),
    );

    try {
      const blockTypes = Object.values(schema.nodes)
        .filter((nodeType) => nodeType.spec.group === "block")
        .map((nodeType) => nodeType.name);

      expect(blockTypes[0]).toBe("paragraph");
      expect(schema.topNodeType.createAndFill()?.type.name).toBe("doc");
    } finally {
      awareness.destroy();
      ydoc.destroy();
    }
  });
});
