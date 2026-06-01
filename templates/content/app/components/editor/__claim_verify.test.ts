// @vitest-environment happy-dom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { describe, expect, it } from "vitest";
import {
  parseNfmForEditor,
  serializeEditorToNfm,
  normalizeNfmForStorage,
  normalizeNfmForNotion,
} from "@shared/notion-markdown";
import { EmptyLineParagraph } from "./VisualEditor";
import { CodeBlock } from "./extensions/CodeBlockNode";
import { NotionToggle } from "./extensions/NotionExtensions";

// Mirror the markdown editor used in existing tests + the real serialize path.
function createMarkdownEditor(content: string) {
  return new Editor({
    extensions: [
      StarterKit.configure({ codeBlock: false, paragraph: false }),
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

// The REAL production round trip: stored NFM -> editor -> getMarkdown -> serializeEditorToNfm
function realRoundTrip(stored: string): string {
  const editor = createMarkdownEditor(stored);
  try {
    const md = (editor.storage as any).markdown.getMarkdown();
    return serializeEditorToNfm(md);
  } finally {
    editor.destroy();
  }
}

describe("CLAIM: phantom blank line between parent and tab-indented child", () => {
  const cases = [
    ["plain indented text", "parent\n\tchild"],
    ["list under paragraph", "parent\n\t- child"],
    ["deeper plain indent", "parent\n\tchild\n\t\tgrandchild"],
  ];

  it.fails("CLAIM shortcut: serializeEditorToNfm(parseNfmForEditor(x))", () => {
    for (const [label, input] of cases) {
      const stored = normalizeNfmForStorage(input);
      const editorMd = parseNfmForEditor(input);
      const shortcut = serializeEditorToNfm(editorMd);

      expect(shortcut, label).not.toContain("\n\n\t");
      expect(normalizeNfmForNotion(shortcut), label).toBe(
        normalizeNfmForNotion(stored),
      );
    }
  });

  it.fails("REAL markdown editor round trip", () => {
    for (const [label, input] of cases) {
      const stored = normalizeNfmForStorage(input);
      const rt = realRoundTrip(stored);
      const notionStored = normalizeNfmForNotion(stored);
      const notionRt = normalizeNfmForNotion(rt);

      expect(rt, label).not.toContain("\n\n\t");
      expect(notionRt, label).toBe(notionStored);
    }
  });
});
