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
import { NotionToggle } from "./extensions/NotionExtensions";

function createMarkdownEditor(content: string) {
  return new Editor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        paragraph: false,
      }),
      CodeBlock,
      EmptyLineParagraph,
      NotionToggle,
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

  it("preserves toggles, bullets, dividers, and following paragraphs", () => {
    const editor = createMarkdownEditor(
      [
        "NOW",
        "",
        "→ brent/josh needs",
        "",
        "→ → work for Milos and Nicholas - make clip",
        "",
        "<details>",
        "<summary>→ → team mtg guidance on hackathon</summary>",
        "</details>",
        "",
        "Let people test creating apps, creating agents, editing apps",
        "",
        "- Make sure works",
        "- Give some docs and guidance",
        '- Get some people testing tmrw (post in general "for brave souls")',
        "- Make sure the agent is good at telling you what makes sense and doesn't",
        "",
        "---",
        "",
        "make sure everyone has access to dispatch",
      ].join("\n"),
    );

    try {
      const json = editor.getJSON();
      const markdown = (editor.storage as any).markdown.getMarkdown();
      const stored = serializeEditorToNfm(markdown);

      expect(JSON.stringify(json)).toContain('"notionToggle"');
      expect(JSON.stringify(json)).toContain('"bulletList"');
      expect(JSON.stringify(json)).toContain('"horizontalRule"');
      expect(stored).toContain("<details>");
      expect(stored).toContain(
        "<summary>→ → team mtg guidance on hackathon</summary>",
      );
      expect(stored).toContain("</details>");
      expect(stored).toContain("- Make sure works");
      expect(stored).toContain("---\n\nmake sure everyone has access");
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
