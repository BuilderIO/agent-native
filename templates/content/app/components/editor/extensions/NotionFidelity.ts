import { Extension, Node, mergeAttributes } from "@tiptap/core";

/**
 * Fidelity extensions that let the TipTap schema losslessly represent the
 * Notion-flavored-Markdown features the sync converter (`shared/nfm.ts`) needs:
 *
 *   - Block colors (`{color="red"}`) on paragraphs, headings, quotes, table
 *     cells/rows.
 *   - Visual indentation (Notion lets any block be a child of another). We model
 *     it as an `indent` attribute on paragraphs/headings, set by Tab — matching
 *     Notion, where Tab indents a block rather than turning it into a quote.
 *   - Synced blocks as a real container node so their children round-trip
 *     instead of being dropped (the previous atom modelling silently lost the
 *     synced content, risking deletion on push).
 *
 * These keep the editor's ProseMirror JSON a faithful mirror of the Notion
 * block tree so `docToNfm(editor.getJSON())` is byte-stable.
 */

const COLOR_TYPES = [
  "paragraph",
  "heading",
  "blockquote",
  "tableCell",
  "tableHeader",
  "tableRow",
];
const INDENT_TYPES = ["paragraph", "heading"];
const MAX_INDENT = 12;

export const NotionBlockColor = Extension.create({
  name: "notionBlockColor",
  addGlobalAttributes() {
    return [
      {
        types: COLOR_TYPES,
        attributes: {
          color: {
            default: null,
            parseHTML: (element) => element.getAttribute("data-notion-color"),
            renderHTML: (attributes) => {
              if (!attributes.color) return {};
              const color = String(attributes.color);
              const isBg = color.endsWith("_bg");
              const base = isBg ? color.slice(0, -3) : color;
              return {
                "data-notion-color": color,
                class: isBg
                  ? `notion-block-bg notion-block-bg--${base}`
                  : `notion-block-color notion-block-color--${base}`,
              };
            },
          },
        },
      },
    ];
  },
});

export const NotionBlockIndentAttr = Extension.create({
  name: "notionBlockIndentAttr",
  priority: 50,

  addGlobalAttributes() {
    return [
      {
        types: INDENT_TYPES,
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element) => {
              const value = Number.parseInt(
                element.getAttribute("data-indent") || "0",
                10,
              );
              return Number.isFinite(value) && value > 0
                ? Math.min(value, MAX_INDENT)
                : 0;
            },
            renderHTML: (attributes) => {
              const value = Number(attributes.indent) || 0;
              if (value <= 0) return {};
              return {
                "data-indent": String(value),
                style: `margin-left: ${value * 1.5}em`,
              };
            },
          },
        },
      },
    ];
  },

  addKeyboardShortcuts() {
    const inHandledNode = (editor: any) =>
      editor.isActive("listItem") ||
      editor.isActive("taskItem") ||
      editor.isActive("tableCell") ||
      editor.isActive("tableHeader") ||
      editor.isActive("codeBlock");

    const shiftIndent = (editor: any, delta: number) => {
      const { selection } = editor.state;
      const node = selection.$from.parent;
      if (!node || !INDENT_TYPES.includes(node.type.name)) return false;
      const current = Number(node.attrs.indent) || 0;
      const next = Math.max(0, Math.min(MAX_INDENT, current + delta));
      if (next === current) return delta < 0;
      return editor.commands.updateAttributes(node.type.name, { indent: next });
    };

    return {
      Tab: ({ editor }) => {
        if (inHandledNode(editor)) return false;
        return shiftIndent(editor, 1);
      },
      "Shift-Tab": ({ editor }) => {
        if (inHandledNode(editor)) return false;
        return shiftIndent(editor, -1);
      },
    };
  },
});

/**
 * A synced block container. Children are real editor blocks so the synced
 * content round-trips to/from Notion instead of being discarded.
 */
export const NotionSyncedBlock = Node.create({
  name: "notionSyncedBlock",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      url: { default: null },
      isReference: { default: false },
      notice: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-notion-synced-block]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-notion-synced-block": "true",
        "data-synced-reference": HTMLAttributes.isReference
          ? "true"
          : undefined,
        class: "notion-synced-block",
      }),
      0,
    ];
  },
});

export const notionFidelityExtensions = [
  NotionBlockColor,
  NotionBlockIndentAttr,
  NotionSyncedBlock,
];
