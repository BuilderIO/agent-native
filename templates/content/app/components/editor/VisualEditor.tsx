import {
  useEditor,
  EditorContent,
  Extension,
  Node as TiptapNode,
  mergeAttributes,
} from "@tiptap/react";
import type { Editor as CoreEditor, Extensions } from "@tiptap/core";
import Collaboration, { isChangeOrigin } from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import type { Doc as YDoc } from "yjs";
import { Awareness } from "y-protocols/awareness";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Blockquote from "@tiptap/extension-blockquote";
import Link from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Table as BaseTable } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { Markdown } from "tiptap-markdown";
import { defaultMarkdownSerializer } from "prosemirror-markdown";
import { Plugin, PluginKey, AllSelection, Selection } from "@tiptap/pm/state";
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { useEffect, useRef, useMemo, useState } from "react";
import { IconMusic, IconPhoto, IconVideo } from "@tabler/icons-react";
import { BubbleToolbar } from "./BubbleToolbar";
import { SlashCommandMenu } from "./SlashCommandMenu";
import { LinkHoverPreview } from "./LinkHoverPreview";
import { TableHoverControls } from "./TableHoverControls";
import { ImageNode } from "./extensions/ImageNode";
import { VideoNode } from "./extensions/VideoNode";
import { AudioNode } from "./extensions/AudioNode";
import {
  EMPTY_TOGGLE_BODY_PLACEHOLDER,
  focusMostRecentEmptyToggleSummary,
  notionEditorExtensions,
} from "./extensions/NotionExtensions";
import { notionFidelityExtensions } from "./extensions/NotionFidelity";
import { DragHandle } from "./extensions/DragHandle";
import { CodeBlock } from "./extensions/CodeBlockNode";
import { toast } from "sonner";
import { canonicalizeNfm, docToNfm, nfmToDoc } from "@shared/nfm";
import {
  isReconcileLeadClient,
  AGENT_CLIENT_ID,
} from "@agent-native/core/client";
import {
  getImageFiles,
  getAudioFiles,
  getVideoFiles,
  hasAudioFiles,
  hasImageFiles,
  hasVideoFiles,
  audioUploadErrorMessage,
  imageUploadErrorMessage,
  uploadAudioFile,
  uploadImageFile,
  uploadVideoFile,
  videoUploadErrorMessage,
} from "./image-upload";

/**
 * Override the paragraph node's markdown serialization so that empty
 * paragraphs survive round-trips. Without this, prosemirror-markdown
 * silently drops empty paragraphs and they disappear from the document.
 *
 * On the parse side, the updateDOM hook strips &nbsp; from paragraphs
 * so TipTap creates truly empty paragraph nodes (no visible space).
 *
 * This replaces StarterKit's paragraph node so tiptap-markdown reads the
 * serializer from the paragraph extension itself. A separate monkey-patch
 * extension was too timing-sensitive and could miss the serializer instance.
 */
export const EmptyLineParagraph = TiptapNode.create({
  name: "paragraph",

  // Match Tiptap's built-in paragraph priority so ProseMirror chooses a
  // paragraph as the default filler for `block+` content. If recursive block
  // containers come first, collaborative empty-doc creation can overflow.
  priority: 1000,

  group: "block",
  content: "inline*",

  parseHTML() {
    return [{ tag: "p" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["p", mergeAttributes(HTMLAttributes), 0];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any, parent: any, index: number) {
          if (node.childCount === 0) {
            state.write("&nbsp;");
            state.closeBlock(node);
            return;
          }

          defaultMarkdownSerializer.nodes.paragraph(state, node, parent, index);
        },
        parse: {
          updateDOM(element: HTMLElement) {
            for (const p of element.querySelectorAll("p")) {
              if (
                p.childNodes.length === 1 &&
                p.firstChild?.nodeType === 3 &&
                p.firstChild.textContent === "\u00A0"
              ) {
                p.innerHTML = "";
              }
            }
          },
        },
      },
    };
  },
});

/**
 * Detects whether plain text looks like markdown by checking for common
 * markdown patterns (headings, lists, bold/italic, links, code blocks, etc.).
 * When pasting, the clipboard often has both HTML and plain text — TipTap
 * prefers the HTML, which renders markdown syntax literally. This regex-based
 * heuristic lets us intercept and parse the plain text as markdown instead.
 */
const MARKDOWN_PATTERNS = [
  /^#{1,6}\s+\S/m, // headings
  /^\s*[-*+]\s+\S/m, // unordered lists
  /^\s*\d+\.\s+\S/m, // ordered lists
  /^\s*[-*_]{3,}\s*$/m, // horizontal rules
  /^\s*>\s+\S/m, // blockquotes
  /^\s*```/m, // code fences
  /\*\*\S.*?\S\*\*/m, // bold
  /\*\S.*?\S\*/m, // italic
  /\[.+?\]\(.+?\)/m, // links
  /^\s*- \[[ x]\]\s/m, // task lists
  /\|.+\|.+\|/m, // tables
];

function looksLikeMarkdown(text: string): boolean {
  // Need at least 2 matching patterns to avoid false positives
  let matches = 0;
  for (const pattern of MARKDOWN_PATTERNS) {
    if (pattern.test(text)) {
      matches++;
      if (matches >= 2) return true;
    }
  }
  // Single heading at the start is a strong enough signal on its own
  if (matches === 1 && /^#{1,6}\s+\S/m.test(text)) return true;
  return false;
}

/**
 * ProseMirror plugin that intercepts paste events and converts markdown
 * plain text into rich editor content, similar to Notion's paste behavior.
 * When the clipboard has HTML (e.g. from a code editor), TipTap normally
 * uses that HTML — which renders markdown syntax literally. This plugin
 * detects markdown in the plain text and parses it as rich content instead.
 */
const MarkdownPasteDetection = Extension.create({
  name: "markdownPasteDetection",
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey("markdownPasteDetection"),
        props: {
          handlePaste(view, event) {
            const clipboardData = event.clipboardData;
            if (!clipboardData) return false;

            const html = clipboardData.getData("text/html");
            const plainText = clipboardData.getData("text/plain");

            // Only intercept when there's both HTML and plain text,
            // and the plain text looks like markdown. If there's no HTML,
            // tiptap-markdown's transformPastedText handles it already.
            if (!html || !plainText || !looksLikeMarkdown(plainText)) {
              return false;
            }

            // Check if the HTML already has rich structure (from a rich text
            // source like Google Docs) — if so, let TipTap handle it normally.
            const div = document.createElement("div");
            div.innerHTML = html;
            const hasRichStructure = div.querySelector(
              "h1, h2, h3, h4, h5, h6, ul, ol, blockquote, table",
            );
            // But allow interception if the HTML is just a code/pre wrapper
            // (from code editors or terminals)
            const isCodeWrapper =
              div.querySelector("pre, code") !== null && !hasRichStructure;

            if (hasRichStructure && !isCodeWrapper) {
              return false;
            }

            // Prevent default paste and insert markdown as content —
            // tiptap-markdown will parse it into rich nodes
            event.preventDefault();
            editor.commands.insertContent(
              (editor.storage as any).markdown.parser.parse(plainText),
            );
            return true;
          },
        },
      }),
    ];
  },
});

const ARROW_REPLACEMENTS: [string, string][] = [
  ["->", "→"],
  ["<-", "←"],
  ["=>", "⇒"],
];

const TypographyReplacements = Extension.create({
  name: "typographyReplacements",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("typographyReplacements"),
        props: {
          handleTextInput(view, from, to, text) {
            const { state } = view;
            for (const [trigger, replacement] of ARROW_REPLACEMENTS) {
              const lastChar = trigger[trigger.length - 1];
              if (text !== lastChar) continue;
              const prefix = trigger.slice(0, -1);
              const start = from - prefix.length;
              if (start < 0) continue;
              const before = state.doc.textBetween(start, from, "");
              if (before !== prefix) continue;
              view.dispatch(state.tr.insertText(replacement, start, to));
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});

const SelectAllDocument = Extension.create({
  name: "selectAllDocument",
  addKeyboardShortcuts() {
    return {
      "Mod-a": ({ editor }) => {
        const { state, view } = editor;
        view.dispatch(state.tr.setSelection(new AllSelection(state.doc)));
        return true;
      },
    };
  },
});

const JoinFirstBodyBlockToTitle = Extension.create<{
  onJoinTitle?: (text: string) => void;
}>({
  name: "joinFirstBodyBlockToTitle",

  addOptions() {
    return {
      onJoinTitle: undefined,
    };
  },

  addKeyboardShortcuts() {
    const joinFirstBodyBlock = ({ editor }: { editor: CoreEditor }) => {
      const { state, view } = editor;
      const { doc, selection } = state;
      if (!selection.empty) return false;

      const { $from } = selection;
      const firstBlock = doc.firstChild;
      if (
        !firstBlock ||
        $from.depth !== 1 ||
        $from.before() !== 0 ||
        !$from.parent.isTextblock ||
        $from.parentOffset !== 0
      ) {
        return false;
      }

      const text = firstBlock.textContent.trim();
      if (!text) {
        queueMicrotask(() => this.options.onJoinTitle?.(""));
        return true;
      }

      const paragraph = state.schema.nodes.paragraph;
      const tr =
        doc.childCount === 1 && paragraph
          ? state.tr.replaceWith(0, firstBlock.nodeSize, paragraph.create())
          : state.tr.delete(0, firstBlock.nodeSize);
      view.dispatch(tr.scrollIntoView());
      queueMicrotask(() => this.options.onJoinTitle?.(text));
      return true;
    };

    return {
      Backspace: joinFirstBodyBlock,
      Delete: joinFirstBodyBlock,
    };
  },
});

const NotionBlockquote = Blockquote.extend({
  addInputRules() {
    return [];
  },
});

const DEFAULT_EMPTY_BLOCK_PLACEHOLDER =
  "Press ‘space’ for AI or ‘/’ for commands";

const NotionMarkdownShortcuts = Extension.create({
  name: "notionMarkdownShortcuts",
  priority: 1000,

  addProseMirrorPlugins() {
    const editor = this.editor;

    const readBlockShortcut = (
      view: EditorView,
      from: number,
      text: string,
    ) => {
      if (!view.state.selection.empty) return null;

      const { $from } = view.state.selection;
      if (!$from.parent.isTextblock) return null;

      const blockStart = $from.start();
      const textBeforeCursor = view.state.doc.textBetween(blockStart, from);
      const quoteMarkers = new Set([">", "|", '"']);
      const marker =
        text === " " && quoteMarkers.has(textBeforeCursor)
          ? textBeforeCursor
          : textBeforeCursor === "" &&
              text.endsWith(" ") &&
              quoteMarkers.has(text.trim())
            ? text.trim()
            : null;

      if (!marker) return null;

      return {
        marker,
        blockFrom: $from.before(),
        blockTo: $from.after(),
      };
    };

    return [
      new Plugin({
        key: new PluginKey("notionMarkdownShortcuts"),
        props: {
          handleTextInput(view, from, _to, text) {
            const shortcut = readBlockShortcut(view, from, text);
            if (!shortcut) return false;

            const { schema } = view.state;
            const paragraph = schema.nodes.paragraph;
            if (!paragraph) return false;

            if (shortcut.marker === ">") {
              const toggle = schema.nodes.notionToggle;
              if (!toggle) return false;

              view.dispatch(
                view.state.tr
                  .replaceWith(
                    shortcut.blockFrom,
                    shortcut.blockTo,
                    toggle.create(
                      { summary: "", open: true },
                      paragraph.create(),
                    ),
                  )
                  .scrollIntoView(),
              );
              focusMostRecentEmptyToggleSummary(editor);
              return true;
            }

            const blockquote = schema.nodes.blockquote;
            if (!blockquote) return false;

            const tr = view.state.tr.replaceWith(
              shortcut.blockFrom,
              shortcut.blockTo,
              blockquote.create(null, paragraph.create()),
            );
            tr.setSelection(
              Selection.near(tr.doc.resolve(shortcut.blockFrom + 2)),
            );
            view.dispatch(tr.scrollIntoView());
            return true;
          },
        },
      }),
    ];
  },
});

const NotionToggleBodyPlaceholder = Extension.create({
  name: "notionToggleBodyPlaceholder",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("notionToggleBodyPlaceholder"),
        props: {
          decorations: ({ doc, selection }) => {
            const decorations: Decoration[] = [];

            doc.descendants((node, pos, parent) => {
              const selectionIsInsideNode =
                selection.from >= pos && selection.to <= pos + node.nodeSize;

              if (
                node.type.name !== "paragraph" ||
                parent?.type.name !== "notionToggle" ||
                node.content.size > 0 ||
                node.textContent.trim() ||
                selectionIsInsideNode
              ) {
                return;
              }

              decorations.push(
                Decoration.node(pos, pos + node.nodeSize, {
                  class: "is-empty notion-toggle__body-placeholder",
                  "data-placeholder": EMPTY_TOGGLE_BODY_PLACEHOLDER,
                }),
              );
            });

            return DecorationSet.create(doc, decorations);
          },
        },
      }),
    ];
  },
});

/**
 * Tab / Shift-Tab indents any block (paragraph, heading, blockquote, etc.)
 * by wrapping it in a blockquote — which the NFM pipeline already serializes
 * as tab indentation while the editor renders it with quote styling.
 *
 * Runs at lower priority than ListItem/TaskItem (which bind Tab to sinkListItem),
 * so list sinking still works and we only kick in for non-list blocks.
 */
const CustomTable = BaseTable.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      // Notion table structure attributes — preserved so the NFM converter can
      // round-trip header rows/columns, full-width tables, and column colors.
      headerRow: {
        default: false,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-header-row") === "true",
        renderHTML: (attributes: Record<string, any>) =>
          attributes.headerRow ? { "data-header-row": "true" } : {},
      },
      headerColumn: {
        default: false,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-header-column") === "true",
        renderHTML: (attributes: Record<string, any>) =>
          attributes.headerColumn ? { "data-header-column": "true" } : {},
      },
      fitPageWidth: {
        default: false,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-fit-page-width") === "true",
        renderHTML: (attributes: Record<string, any>) =>
          attributes.fitPageWidth ? { "data-fit-page-width": "true" } : {},
      },
      colMeta: {
        default: null,
        parseHTML: () => null,
        renderHTML: () => ({}),
      },
    };
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          state.inTable = true;
          node.forEach((row: any, _p: number, i: number) => {
            state.write("| ");
            row.forEach((col: any, _p: number, j: number) => {
              if (j) {
                state.write(" | ");
              }
              col.forEach((child: any, _offset: number, index: number) => {
                if (index > 0) state.write("<br>");

                if (child.type.name === "image") {
                  const src = child.attrs.src || "";
                  const alt = child.attrs.alt || "";
                  const title = child.attrs.title || "";
                  const escapedTitle = title
                    ? ` "${title.replace(/"/g, '\\"')}"`
                    : "";
                  state.write(
                    `![${state.esc(alt)}](${state.esc(src)}${escapedTitle})`,
                  );
                } else if (child.isTextblock) {
                  const oldWrite = state.write;
                  state.write = function (str?: string) {
                    if (str === undefined) {
                      oldWrite.call(this);
                    } else {
                      oldWrite.call(this, str.replace(/\n/g, "<br>"));
                    }
                  };
                  state.renderInline(child);
                  state.write = oldWrite;
                } else {
                  state.write(
                    state.esc(child.textContent || "").replace(/\n/g, " "),
                  );
                }
              });
            });
            state.write(" |");
            state.ensureNewLine();

            if (i === 0) {
              const delimiterRow = Array.from({ length: row.childCount })
                .map(() => "---")
                .join(" | ");
              state.write(`| ${delimiterRow} |`);
              state.ensureNewLine();
            }
          });
          state.closeBlock(node);
          state.inTable = false;
        },
        parse: {},
      },
    };
  },
});

const NotionTableHeader = TableHeader.extend({
  renderHTML({ HTMLAttributes }) {
    return [
      "td",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: "notion-table-header-cell",
      }),
      0,
    ];
  },
});

function getNodeChildren(node: ProseMirrorNode | null | undefined) {
  const children: ProseMirrorNode[] = [];
  node?.forEach((child) => children.push(child));
  return children;
}

function isTableHeaderNode(cell: ProseMirrorNode | undefined) {
  return cell?.type.name === "tableHeader";
}

function normalizeTableHeaderCells(
  table: ProseMirrorNode,
  tableCellType: ProseMirrorNode["type"],
  tableHeaderType: ProseMirrorNode["type"],
) {
  const rows = getNodeChildren(table);
  if (rows.length === 0) return table;

  const firstRowCells = getNodeChildren(rows[0]);
  const hasHeaderRow =
    firstRowCells.length > 0 && firstRowCells.every(isTableHeaderNode);
  const hasHeaderColumn = rows.every((row) =>
    isTableHeaderNode(getNodeChildren(row)[0]),
  );
  let changed = false;

  const normalizedRows = rows.map((row, rowIndex) => {
    const cells = getNodeChildren(row);
    let rowChanged = false;
    const normalizedCells = cells.map((cell, columnIndex) => {
      const targetType =
        (hasHeaderRow && rowIndex === 0) ||
        (hasHeaderColumn && columnIndex === 0)
          ? tableHeaderType
          : tableCellType;

      if (cell.type === targetType) return cell;

      changed = true;
      rowChanged = true;
      return targetType.create(cell.attrs, cell.content, cell.marks);
    });

    return rowChanged ? row.copy(Fragment.fromArray(normalizedCells)) : row;
  });

  return changed ? table.copy(Fragment.fromArray(normalizedRows)) : table;
}

const normalizeTableHeadersPluginKey = new PluginKey("normalizeTableHeaders");

function buildNormalizeTableHeadersTransaction(state: CoreEditor["state"]) {
  const tableCellType = state.schema.nodes.tableCell;
  const tableHeaderType = state.schema.nodes.tableHeader;
  if (!tableCellType || !tableHeaderType) return null;

  let transaction = state.tr;
  let changed = false;

  state.doc.descendants((node, pos) => {
    if (node.type.name !== "table") return true;

    const normalizedTable = normalizeTableHeaderCells(
      node,
      tableCellType,
      tableHeaderType,
    );
    if (normalizedTable !== node) {
      transaction = transaction.replaceWith(
        pos,
        pos + node.nodeSize,
        normalizedTable,
      );
      changed = true;
    }

    return false;
  });

  return changed
    ? transaction.setMeta(normalizeTableHeadersPluginKey, true)
    : null;
}

function dispatchNormalizeTableHeaders(view: EditorView) {
  const transaction = buildNormalizeTableHeadersTransaction(view.state);
  if (transaction) {
    view.dispatch(transaction);
  }
}

const NormalizeTableHeaders = Extension.create({
  name: "normalizeTableHeaders",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: normalizeTableHeadersPluginKey,
        appendTransaction(transactions, _oldState, newState) {
          if (
            transactions.some((transaction) =>
              transaction.getMeta(normalizeTableHeadersPluginKey),
            ) ||
            !transactions.some((transaction) => transaction.docChanged)
          ) {
            return null;
          }

          return buildNormalizeTableHeadersTransaction(newState);
        },
        view(view) {
          let destroyed = false;

          queueMicrotask(() => {
            if (!destroyed) {
              dispatchNormalizeTableHeaders(view);
            }
          });

          return {
            destroy() {
              destroyed = true;
            },
          };
        },
      }),
    ];
  },
});

interface VisualEditorProps {
  documentId?: string;
  content: string;
  /**
   * Server `updatedAt` for `content`. Used to tell a genuinely-newer external
   * edit (agent / Notion / peer-via-SQL) apart from a stale autosave echo or a
   * lagging poll — only newer content is reconciled into the live editor.
   */
  contentUpdatedAt?: string | null;
  onChange: (markdown: string) => void;
  /** Yjs document for collaborative editing. */
  ydoc?: YDoc | null;
  /** Shared awareness instance for collaborative cursors/presence. */
  awareness?: Awareness | null;
  /** Current user info for cursor labels. */
  user?: { name: string; color: string; email?: string };
  editable?: boolean;
  /** Called when user selects text and clicks "Comment" in bubble toolbar. */
  onComment?: (quotedText: string, offsetTop: number) => void;
  onJoinTitle?: (text: string) => void;
}

export function shouldSeedCollaborativeContent({
  content,
  currentMarkdown,
  fragmentLength,
}: {
  content: string;
  currentMarkdown: string;
  fragmentLength: number;
}): boolean {
  const semanticMarkdown = currentMarkdown
    .split(/\r?\n/)
    .filter((line) => !/^<empty-block\b[^>]*\/>$/.test(line.trim()))
    .join("\n")
    .trim();
  return !!content.trim() && (fragmentLength === 0 || !semanticMarkdown);
}

export function shouldApplyExternalContentSync({
  docChanged,
  content,
  lastEmittedMarkdown,
  currentMarkdown,
  nextMarkdown,
  contentUpdatedAt,
  lastAppliedUpdatedAt,
  isLeadClient,
  editorFocused,
  lastTypedAt,
  now,
}: {
  docChanged: boolean;
  content: string;
  lastEmittedMarkdown: string;
  currentMarkdown: string;
  nextMarkdown: string;
  /** Server updatedAt for the incoming `content`. */
  contentUpdatedAt?: string | null;
  /** updatedAt of the content this editor currently reflects. */
  lastAppliedUpdatedAt?: string | null;
  /** Whether this client is the elected applier (see isReconcileLeadClient). */
  isLeadClient: boolean;
  editorFocused: boolean;
  lastTypedAt: number;
  now: number;
}): boolean {
  // Editor already shows the incoming content — e.g. a peer's edit arrived via
  // Yjs first, or this is our own state. Nothing to apply.
  if (currentMarkdown === nextMarkdown) return false;

  // Our own save echoing back from the server.
  if (content === lastEmittedMarkdown) return false;

  // Only adopt content that is genuinely NEWER than what this editor already
  // reflects. An older-or-equal `updatedAt` is a lagging poll / stale snapshot
  // and must never overwrite live edits — this is what stops the "agent edit
  // reverts on next poll" whack-a-mole. A fresh mount / doc-switch has no
  // baseline yet, so it always adopts the loaded content.
  const externalNewer =
    docChanged ||
    !lastAppliedUpdatedAt ||
    (!!contentUpdatedAt && contentUpdatedAt > lastAppliedUpdatedAt);
  if (!externalNewer) return false;

  // Exactly one client (the lead) applies an authoritative snapshot into the
  // shared Y.Doc; every other client receives it through Yjs. Without this, N
  // clients would each diff the same snapshot into the CRDT and duplicate the
  // changed region. Mount / doc-switch loads are local-only, so always allowed.
  if (!isLeadClient && !docChanged) return false;

  // Don't yank text out from under someone typing this instant; the caller
  // retries shortly so the edit still lands once they pause.
  const typingRightNow = editorFocused && now - lastTypedAt < 1500;
  if (typingRightNow && !docChanged) return false;

  return true;
}

interface VisualEditorExtensionOptions {
  documentId?: string;
  ydoc?: YDoc | null;
  localAwareness?: Awareness | null;
  user?: { name: string; color: string; email?: string } | null;
  onImageComment?: (quotedText: string, offsetTop: number) => void;
  onJoinTitle?: (text: string) => void;
}

function hasAncestorType(
  editor: CoreEditor,
  pos: number,
  typeName: string,
): boolean {
  const doc = editor.state.doc;
  const positions = [
    Math.max(0, pos - 1),
    pos,
    Math.min(doc.content.size, pos + 1),
  ];

  return positions.some((candidatePos) => {
    const resolvedPos = doc.resolve(candidatePos);

    for (let depth = resolvedPos.depth; depth >= 0; depth -= 1) {
      if (resolvedPos.node(depth).type.name === typeName) return true;
    }

    return false;
  });
}

type MediaNodeType = "image" | "video" | "audio";

function mediaNodeLabel(typeName: MediaNodeType) {
  if (typeName === "image") return "Image";
  if (typeName === "video") return "Video";
  return "Audio";
}

function createMediaUploadId(kind: MediaNodeType) {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${kind}-upload-${random}`;
}

interface PendingMediaUpload {
  file: File;
  uploadId: string;
}

function insertPendingMediaNodes(
  view: EditorView,
  typeName: MediaNodeType,
  files: File[],
  position: number,
): PendingMediaUpload[] {
  const nodeType = view.state.schema.nodes[typeName];
  if (!nodeType) {
    throw new Error(
      `${mediaNodeLabel(typeName)} blocks are not available in this editor.`,
    );
  }

  let insertPos = Math.min(position, view.state.doc.content.size);
  let tr = view.state.tr;
  const pendingUploads: PendingMediaUpload[] = [];

  for (const file of files) {
    const uploadId = createMediaUploadId(typeName);
    const node = nodeType.create(
      typeName === "image"
        ? { src: null, alt: "", uploadId }
        : { src: null, uploadId },
    );
    tr = tr.insert(insertPos, node);
    insertPos = Math.min(insertPos + node.nodeSize, tr.doc.content.size);
    pendingUploads.push({ file, uploadId });
  }

  view.dispatch(tr.scrollIntoView());
  return pendingUploads;
}

function updatePendingMediaNode(
  view: EditorView,
  typeName: MediaNodeType,
  uploadId: string,
  attrs: Record<string, unknown>,
) {
  let found = false;
  let tr = view.state.tr;

  view.state.doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === typeName && node.attrs.uploadId === uploadId) {
      tr = tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        ...attrs,
        uploadId: null,
      });
      found = true;
      return false;
    }
    return true;
  });

  if (found) {
    view.dispatch(tr);
  }
  return found;
}

function getVisualEditorPlaceholder({
  editor,
  node,
  pos,
  hasAnchor,
}: {
  editor: CoreEditor;
  node: ProseMirrorNode;
  pos: number;
  hasAnchor: boolean;
}): string {
  const isToggleBody =
    node.type.name === "paragraph" &&
    hasAncestorType(editor, pos, "notionToggle");

  if (isToggleBody) {
    return hasAnchor
      ? DEFAULT_EMPTY_BLOCK_PLACEHOLDER
      : EMPTY_TOGGLE_BODY_PLACEHOLDER;
  }

  if (node.type.name === "heading") {
    if (!hasAnchor) return "";
    const level = node.attrs.level;
    if (level === 1) return "Heading 1";
    if (level === 2) return "Heading 2";
    if (level === 3) return "Heading 3";
    return "Heading 4";
  }

  if (
    node.type.name === "paragraph" &&
    hasAncestorType(editor, pos, "blockquote")
  ) {
    return hasAnchor ? "Empty quote" : "";
  }

  // Skip the long "Press 'space' for AI…" hint inside table cells — it wraps
  // awkwardly in narrow columns and the cell itself is already an affordance.
  if (
    node.type.name === "paragraph" &&
    (hasAncestorType(editor, pos, "tableCell") ||
      hasAncestorType(editor, pos, "tableHeader"))
  ) {
    return "";
  }

  return hasAnchor ? DEFAULT_EMPTY_BLOCK_PLACEHOLDER : "";
}

export async function uploadAndInsertImageFiles(
  view: EditorView,
  files: File[],
  position: number,
): Promise<void> {
  if (files.length === 0) return;

  let pendingUploads: PendingMediaUpload[];
  try {
    pendingUploads = insertPendingMediaNodes(view, "image", files, position);
  } catch (error) {
    toast.error(imageUploadErrorMessage(error));
    return;
  }

  const toastId = toast.loading(
    files.length === 1
      ? "Uploading image..."
      : `Uploading ${files.length} images...`,
  );

  let failed = 0;
  let firstError: unknown = null;

  for (const pending of pendingUploads) {
    try {
      const src = await uploadImageFile(pending.file);
      if (!view.dom.isConnected) return;
      updatePendingMediaNode(view, "image", pending.uploadId, { src, alt: "" });
    } catch (error) {
      failed += 1;
      firstError ??= error;
      if (view.dom.isConnected) {
        updatePendingMediaNode(view, "image", pending.uploadId, {});
      }
    }
  }

  if (failed === 0) {
    toast.success(files.length === 1 ? "Image added" : "Images added", {
      id: toastId,
    });
  } else if (files.length === 1) {
    toast.error(imageUploadErrorMessage(firstError), { id: toastId });
  } else {
    toast.error(
      `${failed} of ${files.length} image uploads failed. ${imageUploadErrorMessage(firstError)}`,
      { id: toastId },
    );
  }
}

export async function uploadAndInsertVideoFiles(
  view: EditorView,
  files: File[],
  position: number,
): Promise<void> {
  if (files.length === 0) return;

  let pendingUploads: PendingMediaUpload[];
  try {
    pendingUploads = insertPendingMediaNodes(view, "video", files, position);
  } catch (error) {
    toast.error(videoUploadErrorMessage(error));
    return;
  }

  const toastId = toast.loading(
    files.length === 1
      ? "Uploading video..."
      : `Uploading ${files.length} videos...`,
  );

  let failed = 0;
  let firstError: unknown = null;

  for (const pending of pendingUploads) {
    try {
      const src = await uploadVideoFile(pending.file);
      if (!view.dom.isConnected) return;
      updatePendingMediaNode(view, "video", pending.uploadId, { src });
    } catch (error) {
      failed += 1;
      firstError ??= error;
      if (view.dom.isConnected) {
        updatePendingMediaNode(view, "video", pending.uploadId, {});
      }
    }
  }

  if (failed === 0) {
    toast.success(files.length === 1 ? "Video added" : "Videos added", {
      id: toastId,
    });
  } else if (files.length === 1) {
    toast.error(videoUploadErrorMessage(firstError), { id: toastId });
  } else {
    toast.error(
      `${failed} of ${files.length} video uploads failed. ${videoUploadErrorMessage(firstError)}`,
      { id: toastId },
    );
  }
}

export async function uploadAndInsertAudioFiles(
  view: EditorView,
  files: File[],
  position: number,
): Promise<void> {
  if (files.length === 0) return;

  let pendingUploads: PendingMediaUpload[];
  try {
    pendingUploads = insertPendingMediaNodes(view, "audio", files, position);
  } catch (error) {
    toast.error(audioUploadErrorMessage(error));
    return;
  }

  const toastId = toast.loading(
    files.length === 1
      ? "Uploading audio..."
      : `Uploading ${files.length} audio files...`,
  );

  let failed = 0;
  let firstError: unknown = null;

  for (const pending of pendingUploads) {
    try {
      const src = await uploadAudioFile(pending.file);
      if (!view.dom.isConnected) return;
      updatePendingMediaNode(view, "audio", pending.uploadId, { src });
    } catch (error) {
      failed += 1;
      firstError ??= error;
      if (view.dom.isConnected) {
        updatePendingMediaNode(view, "audio", pending.uploadId, {});
      }
    }
  }

  if (failed === 0) {
    toast.success(files.length === 1 ? "Audio added" : "Audio files added", {
      id: toastId,
    });
  } else if (files.length === 1) {
    toast.error(audioUploadErrorMessage(firstError), { id: toastId });
  } else {
    toast.error(
      `${failed} of ${files.length} audio uploads failed. ${audioUploadErrorMessage(firstError)}`,
      { id: toastId },
    );
  }
}

export function createVisualEditorExtensions({
  documentId,
  ydoc,
  localAwareness,
  user,
  onImageComment,
  onJoinTitle,
}: VisualEditorExtensionOptions = {}): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      blockquote: false,
      codeBlock: false,
      paragraph: false,
      link: false,
      horizontalRule: {},
      dropcursor: { color: false, width: 3, class: "notion-dropcursor" },
      // Disable built-in undo/redo when Collaboration is active (Yjs tracks undo)
      ...(ydoc ? { undoRedo: false } : {}),
    }),
    EmptyLineParagraph,
    NotionBlockquote,
    CodeBlock,
    Placeholder.configure({
      placeholder: getVisualEditorPlaceholder,
      showOnlyWhenEditable: true,
      showOnlyCurrent: true,
      includeChildren: true,
    }),
    NotionToggleBodyPlaceholder,
    Link.configure({
      openOnClick: false,
      HTMLAttributes: { class: "notion-link" },
    }),
    TaskList.configure({
      HTMLAttributes: { class: "notion-task-list" },
    }),
    TaskItem.configure({
      nested: true,
    }),
    ImageNode.configure({
      HTMLAttributes: { class: "notion-image" },
      documentId,
      onImageComment,
    }),
    VideoNode.configure({
      HTMLAttributes: { class: "notion-video" },
      documentId,
      onVideoComment: onImageComment,
    }),
    AudioNode.configure({
      HTMLAttributes: { class: "notion-audio" },
      documentId,
      onAudioComment: onImageComment,
    }),
    CustomTable.configure({
      resizable: false,
      HTMLAttributes: { class: "notion-table" },
    }),
    TableRow,
    NotionTableHeader,
    TableCell,
    NormalizeTableHeaders,
    ...notionEditorExtensions,
    ...notionFidelityExtensions,
    DragHandle,
    TypographyReplacements,
    NotionMarkdownShortcuts,
    MarkdownPasteDetection,
    SelectAllDocument,
    JoinFirstBodyBlockToTitle.configure({ onJoinTitle }),
    Markdown.configure({
      html: true,
      transformPastedText: true,
      transformCopiedText: true,
    }),
    // Collaborative editing via Y.XmlFragment
    ...(ydoc ? [Collaboration.configure({ document: ydoc })] : []),
    // Multi-user cursor awareness (live cursor positions + names)
    ...(localAwareness
      ? [
          CollaborationCaret.configure({
            provider: { awareness: localAwareness },
            user: user ?? { name: "Anonymous", color: "#999" },
          }),
        ]
      : []),
  ];
}

export function VisualEditor({
  documentId,
  content,
  contentUpdatedAt,
  onChange,
  ydoc,
  awareness,
  user,
  editable = true,
  onComment,
  onJoinTitle,
}: VisualEditorProps) {
  const [isDraggingMedia, setIsDraggingMedia] = useState(false);
  const isSettingContent = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const prevDocIdRef = useRef(documentId);
  // Track the last content the editor emitted via onChange, so we can
  // distinguish external SQL changes (agent/Notion/peer) from our own saves.
  const lastEmittedRef = useRef<string>("");
  // Tracks the last time the user actually typed (not just had focus), so an
  // external edit can still apply when the user is idle but happens to have the
  // editor focused — without yanking in-progress typing.
  const lastTypedAtRef = useRef<number>(0);
  // updatedAt of the content this editor currently reflects. An older-or-equal
  // refetch is a stale snapshot and is ignored; a newer one is an intentional
  // external edit and is applied. Starts null (no baseline) so the FIRST run
  // reconciles a stale Y.Doc against authoritative SQL content — e.g. when an
  // agent edited the closed doc and the persisted collab state lags behind.
  const lastAppliedUpdatedAtRef = useRef<string | null>(null);

  // Reuse the synced Awareness instance when provided; fall back for tests or
  // non-template embedders that only pass a Y.Doc.
  const fallbackAwareness = useMemo(() => {
    if (awareness) return null;
    if (!ydoc) return null;
    const a = new Awareness(ydoc);
    if (user) {
      a.setLocalStateField("user", user);
    }
    return a;
  }, [awareness, ydoc]);
  const localAwareness = awareness ?? fallbackAwareness;

  // Update user info when it changes
  useEffect(() => {
    if (localAwareness && user) {
      localAwareness.setLocalStateField("user", user);
    }
  }, [localAwareness, user?.name, user?.email, user?.color]);

  // Whether this client is the one that applies authoritative external snapshots
  // (agent / Notion / full-rewrite edits) into the shared Y.Doc. Exactly one
  // client does, so the changed region isn't inserted once per open editor.
  const [isLeadClient, setIsLeadClient] = useState(true);
  // Count of OTHER human collaborators currently present. When >0, a peer's edit
  // also arrives through Yjs, so the SQL-content reconcile must wait-and-recheck
  // to avoid applying the same change twice (Yjs + setContent → duplicated text).
  const peerCountRef = useRef(0);
  useEffect(() => {
    if (!localAwareness || !ydoc) {
      setIsLeadClient(true);
      peerCountRef.current = 0;
      return;
    }
    const update = () => {
      setIsLeadClient(isReconcileLeadClient(localAwareness, ydoc.clientID));
      // Count only VISIBLE peers — a backgrounded peer can't make live Yjs
      // edits, so it shouldn't trigger the dual-path race defer below.
      let peers = 0;
      localAwareness.getStates().forEach((state, clientId) => {
        if (clientId === ydoc.clientID) return; // self
        if (clientId === AGENT_CLIENT_ID) return; // agent isn't a Yjs editor
        const s = state as { user?: unknown; visible?: boolean };
        if (s && s.user && s.visible !== false) peers += 1;
      });
      peerCountRef.current = peers;
    };
    update();
    localAwareness.on("change", update);
    // Re-elect when our own visibility flips: the lead must be a visible client.
    document.addEventListener("visibilitychange", update);
    return () => {
      localAwareness.off("change", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [localAwareness, ydoc]);

  // Clean up awareness on unmount
  useEffect(() => {
    return () => {
      fallbackAwareness?.destroy();
    };
  }, [fallbackAwareness]);

  const extensions = useMemo(
    () =>
      createVisualEditorExtensions({
        documentId,
        ydoc,
        localAwareness,
        user,
        onImageComment: onComment,
        onJoinTitle,
      }),
    [
      documentId,
      ydoc,
      localAwareness,
      user?.name,
      user?.email,
      user?.color,
      onComment,
      onJoinTitle,
    ],
  );

  const editor = useEditor({
    extensions,
    // With Collaboration (ydoc) active, content is owned by the Y.XmlFragment —
    // the seed effect populates an empty doc and the reconcile applies external
    // edits. Passing `content` here would make the editor initialize from the
    // prop AND the Y.Doc, firing an initial (non-remote) update that could
    // autosave a stale value over newer SQL. Only seed `content` when there is
    // no ydoc (tests / non-collaborative embedders).
    content: ydoc ? undefined : nfmToDoc(content),
    editorProps: {
      attributes: {
        class: "notion-editor",
      },
      handleDrop(view, event) {
        setIsDraggingMedia(false);
        if (!view.editable || !event.dataTransfer) return false;

        const imageFiles = getImageFiles(event.dataTransfer.files);
        const videoFiles = getVideoFiles(event.dataTransfer.files);
        const audioFiles = getAudioFiles(event.dataTransfer.files);
        if (
          imageFiles.length === 0 &&
          videoFiles.length === 0 &&
          audioFiles.length === 0
        ) {
          return false;
        }

        event.preventDefault();
        const coords = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        });
        const position = coords?.pos ?? view.state.selection.from;
        if (imageFiles.length > 0) {
          void uploadAndInsertImageFiles(view, imageFiles, position);
        }
        if (videoFiles.length > 0) {
          void uploadAndInsertVideoFiles(view, videoFiles, position);
        }
        if (audioFiles.length > 0) {
          void uploadAndInsertAudioFiles(view, audioFiles, position);
        }
        return true;
      },
      handlePaste(view, event) {
        if (!view.editable || !event.clipboardData) return false;

        const imageFiles = getImageFiles(event.clipboardData.files);
        const videoFiles = getVideoFiles(event.clipboardData.files);
        const audioFiles = getAudioFiles(event.clipboardData.files);
        if (
          imageFiles.length === 0 &&
          videoFiles.length === 0 &&
          audioFiles.length === 0
        ) {
          return false;
        }

        event.preventDefault();
        if (imageFiles.length > 0) {
          void uploadAndInsertImageFiles(
            view,
            imageFiles,
            view.state.selection.from,
          );
        }
        if (videoFiles.length > 0) {
          void uploadAndInsertVideoFiles(
            view,
            videoFiles,
            view.state.selection.from,
          );
        }
        if (audioFiles.length > 0) {
          void uploadAndInsertAudioFiles(
            view,
            audioFiles,
            view.state.selection.from,
          );
        }
        return true;
      },
      handleDOMEvents: {
        dragover(view, event) {
          if (
            !view.editable ||
            (!hasImageFiles(event.dataTransfer) &&
              !hasVideoFiles(event.dataTransfer) &&
              !hasAudioFiles(event.dataTransfer))
          ) {
            return false;
          }
          event.preventDefault();
          event.dataTransfer!.dropEffect = "copy";
          setIsDraggingMedia(true);
          return true;
        },
        dragleave(view, event) {
          const wrapper = view.dom.closest(".visual-editor-wrapper");
          if (
            !wrapper ||
            !(event.relatedTarget instanceof Node) ||
            !wrapper.contains(event.relatedTarget)
          ) {
            setIsDraggingMedia(false);
          }
          return false;
        },
      },
    },
    editable,
    onUpdate: ({ editor, transaction }) => {
      if (isSettingContent.current) return;
      // Never persist remote-originated changes (the initial Yjs state load or a
      // peer's edit arriving via sync). Autosaving those would write a possibly
      // STALE Y.Doc back over newer SQL content — clobbering an agent edit that
      // hasn't been reconciled yet. Each client only saves its OWN local edits;
      // a peer's edit is saved by the peer that made it.
      if (transaction && isChangeOrigin(transaction)) return;
      lastTypedAtRef.current = Date.now();
      try {
        const normalized = docToNfm(editor.getJSON() as any);
        // Don't save empty content when Collaboration hasn't seeded yet —
        // this prevents overwriting DB content with empty string
        if (!normalized.trim() && ydoc) return;
        lastEmittedRef.current = normalized;
        queueMicrotask(() => onChangeRef.current(normalized));
      } catch (err: any) {
        toast.error("Markdown serialization error: " + err.message);
        console.error("Markdown serialization error:", err);
      }
    },
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(editable);
  }, [editor, editable]);

  // Seed Y.XmlFragment from content prop on first load.
  // The Collaboration extension does NOT auto-seed from the content prop —
  // we must do it manually when the fragment is empty.
  const seededDocRef = useRef<string | null>(null);
  useEffect(() => {
    if (!editor || editor.isDestroyed || !ydoc || !content) return;
    // Skip if already seeded for this document
    if (seededDocRef.current === documentId) return;
    // Only the lead client seeds an empty shared doc, so two clients opening a
    // brand-new doc at once don't both seed and duplicate the content.
    if (!isLeadClient) return;
    const fragment = ydoc.getXmlFragment("default");
    const currentMd = docToNfm(editor.getJSON() as any);
    if (
      shouldSeedCollaborativeContent({
        content,
        currentMarkdown: currentMd,
        fragmentLength: fragment.length,
      })
    ) {
      isSettingContent.current = true;
      editor.commands.setContent(nfmToDoc(content));
      isSettingContent.current = false;
      if (contentUpdatedAt) lastAppliedUpdatedAtRef.current = contentUpdatedAt;
    }
    seededDocRef.current = documentId ?? null;
  }, [editor, ydoc, content, documentId, isLeadClient, contentUpdatedAt]);

  // Reconcile authoritative external content (agent edit, Notion pull, or a peer
  // edit mirrored to SQL) into the live editor. Driven by `updatedAt`: only
  // content genuinely newer than what this editor already reflects is applied,
  // so a lagging poll can never revert live edits. The lead client applies it
  // through the real markdown pipeline (so new block structure renders) and the
  // Yjs CRDT propagates the result to every other client and persists it.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const docChanged = documentId !== prevDocIdRef.current;
    if (docChanged) prevDocIdRef.current = documentId;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    // When peers are present, a peer's edit also arrives through Yjs. Wait one
    // poll cycle (+margin) and re-check before applying via setContent, so we
    // don't insert the same change the Yjs sync is about to deliver (which would
    // duplicate the edited region). Agent/Notion edits never come through Yjs,
    // so they survive the wait and still apply.
    const PEER_SETTLE_MS = 2500;

    const run = (deferred = false) => {
      if (cancelled || !editor || editor.isDestroyed) return;
      const nextEditorContent = nfmToDoc(content);
      const currentMd = docToNfm(editor.getJSON() as any);
      const normalizedNext = canonicalizeNfm(content);

      // Already in sync, or our own echo: advance the applied watermark so a
      // later write is correctly recognized as newer, then stop. (After a peer's
      // Yjs edit lands during a deferred wait, this is what makes us no-op.)
      if (currentMd === normalizedNext || content === lastEmittedRef.current) {
        if (contentUpdatedAt)
          lastAppliedUpdatedAtRef.current = contentUpdatedAt;
        return;
      }

      if (
        !shouldApplyExternalContentSync({
          docChanged,
          content,
          lastEmittedMarkdown: lastEmittedRef.current,
          currentMarkdown: currentMd,
          nextMarkdown: normalizedNext,
          contentUpdatedAt,
          lastAppliedUpdatedAt: lastAppliedUpdatedAtRef.current,
          isLeadClient,
          editorFocused: editor.isFocused,
          lastTypedAt: lastTypedAtRef.current,
          now: Date.now(),
        })
      ) {
        // If we only deferred because the user is typing right now, re-check
        // shortly so the external edit still lands once they pause.
        const externalNewer =
          docChanged ||
          !lastAppliedUpdatedAtRef.current ||
          (!!contentUpdatedAt &&
            contentUpdatedAt > lastAppliedUpdatedAtRef.current);
        const typingRightNow =
          editor.isFocused && Date.now() - lastTypedAtRef.current < 1500;
        if (externalNewer && isLeadClient && typingRightNow) {
          retryTimer = setTimeout(() => run(deferred), 700);
        }
        return;
      }

      // Race guard: with collaborators present, let Yjs deliver a peer's edit
      // first. Defer once and re-check — if it was a peer edit, the equality
      // check above will no-op next pass; if it was an agent/Notion edit, it
      // still differs and we apply it below.
      if (!deferred && !docChanged && peerCountRef.current > 0) {
        retryTimer = setTimeout(() => run(true), PEER_SETTLE_MS);
        return;
      }

      // Defer to a microtask so we don't trigger flushSync during a React
      // render — TipTap's setContent dispatches PM transactions that may
      // synchronously update React-owned state via the Collaboration extension.
      queueMicrotask(() => {
        if (cancelled || !editor || editor.isDestroyed) return;
        isSettingContent.current = true;
        // addToHistory: false so cmd+z doesn't erase externally-loaded content.
        editor
          .chain()
          .command(({ tr }) => {
            tr.setMeta("addToHistory", false);
            return true;
          })
          .setContent(nextEditorContent)
          .run();
        isSettingContent.current = false;
        if (contentUpdatedAt)
          lastAppliedUpdatedAtRef.current = contentUpdatedAt;
        lastEmittedRef.current = normalizedNext;
      });
    };

    run();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [content, contentUpdatedAt, editor, documentId, isLeadClient]);

  if (!editor) {
    return (
      <div className="flex flex-col gap-3 px-8 py-6 animate-pulse">
        <div className="h-4 w-2/3 rounded bg-muted" />
        <div className="h-4 w-full rounded bg-muted" />
        <div className="h-4 w-5/6 rounded bg-muted" />
        <div className="h-4 w-3/4 rounded bg-muted" />
      </div>
    );
  }

  return (
    <div
      className={`visual-editor-wrapper${isDraggingMedia ? " visual-editor-wrapper--dragging" : ""}`}
    >
      {editable ? (
        <BubbleToolbar editor={editor} onComment={onComment} />
      ) : null}
      {editable ? (
        <SlashCommandMenu editor={editor} documentId={documentId} />
      ) : null}
      <LinkHoverPreview editor={editor} editable={editable} />
      {editable ? <TableHoverControls editor={editor} /> : null}
      {editable && isDraggingMedia ? (
        <div className="media-drop-overlay">
          <div className="media-drop-overlay__content">
            <IconPhoto size={16} />
            <IconVideo size={16} />
            <IconMusic size={16} />
            <span>Drop media</span>
          </div>
        </div>
      ) : null}
      <EditorContent editor={editor} />
    </div>
  );
}
