import {
  createSharedEditorExtensions,
  useCollabReconcile,
  usePresence,
  useRecentEdits,
  RecentEditHighlights,
  RegistryBlockDataProvider,
  useT,
  type AttributedRecentEdit,
  type RegistryBlockSideMapBlock,
  type UseCollabReconcileResult,
} from "@agent-native/core/client";
import { canonicalizeNfm, docToNfm, nfmToDoc } from "@shared/nfm";
import {
  serializeRegistryBlockToMdx,
  parseRegistryBlockData,
} from "@shared/nfm-registry";
import { IconMusic, IconPhoto, IconVideo } from "@tabler/icons-react";
import type { Editor as CoreEditor, Extensions } from "@tiptap/core";
import Blockquote from "@tiptap/extension-blockquote";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Table as BaseTable } from "@tiptap/extension-table";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableRow } from "@tiptap/extension-table-row";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, AllSelection, Selection } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import {
  useEditor,
  EditorContent,
  Extension,
  Node as TiptapNode,
  mergeAttributes,
} from "@tiptap/react";
import { defaultMarkdownSerializer } from "prosemirror-markdown";
import { useCallback, useEffect, useRef, useMemo, useState } from "react";
import { toast } from "sonner";
import { Markdown } from "tiptap-markdown";
import { Awareness } from "y-protocols/awareness";
import type { Doc as YDoc } from "yjs";

import { contentBlockRegistry } from "@/blocks/contentBlockRegistry";
import type { CommentThread } from "@/hooks/use-comments";

import { BubbleToolbar } from "./BubbleToolbar";
import { resolveAnchor, type CommentTextAnchor } from "./comment-anchors";
import { AudioNode } from "./extensions/AudioNode";
import { CodeBlock } from "./extensions/CodeBlockNode";
import {
  CommentHighlight,
  setCommentHighlights,
  commentHighlightKey,
  type CommentHighlightSpec,
} from "./extensions/CommentHighlight";
import { ContentReferenceNode } from "./extensions/ContentReferenceNode";
import { DragHandle } from "./extensions/DragHandle";
import { ImageNode } from "./extensions/ImageNode";
import {
  LOCAL_FILE_USER_EDIT_META,
  LocalMdxComponentNode,
} from "./extensions/LocalMdxComponentNode";
import {
  EMPTY_TOGGLE_BODY_PLACEHOLDER,
  createNotionEditorExtensions,
  focusMostRecentEmptyToggleSummary,
  type NotionPageLink,
} from "./extensions/NotionExtensions";
import { notionFidelityExtensions } from "./extensions/NotionFidelity";
import {
  LockedSourceComponentBlocks,
  RegistryBlockNode,
} from "./extensions/registryBlocks";
import { VideoNode } from "./extensions/VideoNode";
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
import { LinkHoverPreview } from "./LinkHoverPreview";
import { SlashCommandMenu } from "./SlashCommandMenu";
import { TableHoverControls } from "./TableHoverControls";

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
        setTimeout(() => this.options.onJoinTitle?.(""), 0);
        return true;
      }

      const paragraph = state.schema.nodes.paragraph;
      const tr =
        doc.childCount === 1 && paragraph
          ? state.tr.replaceWith(0, firstBlock.nodeSize, paragraph.create())
          : state.tr.delete(0, firstBlock.nodeSize);
      view.dispatch(tr.scrollIntoView());
      setTimeout(() => this.options.onJoinTitle?.(text), 0);
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

const CONTENT_RECENT_EDIT_TTL_MS = 6_000;
const RECENT_EDIT_MARKER_WIDTH = 2;
const RECENT_EDIT_MIN_MARKER_HEIGHT = 18;

type EditorCoordinateRect = Pick<DOMRect, "left" | "top" | "bottom">;

export function getRecentEditPresenceMarkerRect(
  anchor: EditorCoordinateRect,
): DOMRect {
  return new DOMRect(
    anchor.left,
    anchor.top,
    RECENT_EDIT_MARKER_WIDTH,
    Math.max(RECENT_EDIT_MIN_MARKER_HEIGHT, anchor.bottom - anchor.top),
  );
}

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
  onSaveContent?: (markdown: string) => boolean | Promise<boolean>;
  /** Yjs document for collaborative editing. */
  ydoc?: YDoc | null;
  /** True after the collab provider has loaded persisted Y.Doc state. */
  collabSynced?: boolean;
  /** Shared awareness instance for collaborative cursors/presence. */
  awareness?: Awareness | null;
  /** Current user info for cursor labels. */
  user?: { name: string; color: string; email?: string; avatarUrl?: string };
  editable?: boolean;
  /** Local-file docs should not persist mount-time/schema normalization echoes. */
  localFileMode?: boolean;
  /** Workspace-relative local artifact path for resolving inline references. */
  localFilePath?: string | null;
  /** Current nested local-file reference preview depth. */
  referenceDepth?: number;
  /** Called when user selects text and clicks "Comment" in bubble toolbar. */
  onComment?: (
    quotedText: string,
    offsetTop: number,
    anchor?: CommentTextAnchor,
    range?: { from: number; to: number },
  ) => void;
  /** Open comment threads, used to render inline highlights. */
  commentThreads?: CommentThread[];
  /** Currently focused thread — its highlight is emphasized. */
  activeThreadId?: string | null;
  /** Selection range of the in-progress (not yet saved) comment, if any. */
  pendingHighlight?: { from: number; to: number } | null;
  /** Called when the user clicks an inline highlight in the document. */
  onActivateThread?: (threadId: string) => void;
  onJoinTitle?: (text: string) => void;
  notionPageLinks?: NotionPageLink[];
  onOpenNotionPageLink?: (documentId: string) => void;
  /**
   * The open document's linked Notion page id, when it has one. Drives Notion
   * gating for the registry-block slash menu (offer only NFM-compatible blocks)
   * and lights up the "Won't sync to Notion" badge on any already-present block
   * whose type has no NFM analog (via the shared registry-block side-map).
   */
  notionPageId?: string | null;
}

export type { NotionPageLink };

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

/**
 * Parse authoritative Content NFM with Content's exact NFM parser before the
 * shared reconcile computes its top-level surgical diff.
 *
 * Falling back to the shared CommonMark parser is lossy here: canonical NFM
 * stores one Notion block per line without blank paragraph separators, while
 * CommonMark merges those consecutive lines into one paragraph. That made
 * external replacements such as Notion conflict resolution and version
 * restores look correct in the non-collaborative history preview, then collapse
 * into one wrapped paragraph when reconciled into the live Y.Doc.
 */
export function parseNfmForCollabReconcile(
  editor: CoreEditor,
  value: string,
): ProseMirrorNode | null {
  try {
    return editor.schema.nodeFromJSON(nfmToDoc(value) as any);
  } catch {
    return null;
  }
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

export function shouldPersistLocalFileEditorUpdate({
  docChanged,
  editorFocused,
  explicitLocalFileUserEdit,
  recentUserEditIntent,
  transactionUiEvent,
}: {
  docChanged: boolean;
  editorFocused: boolean;
  explicitLocalFileUserEdit?: boolean;
  recentUserEditIntent: boolean;
  transactionUiEvent: unknown;
}): boolean {
  if (!docChanged) return false;
  if (explicitLocalFileUserEdit) return true;
  if (editorFocused) return true;
  if (recentUserEditIntent) return true;
  return Boolean(transactionUiEvent);
}

function isActiveSlashCommandDraft(editor: CoreEditor): boolean {
  const { state } = editor;
  if (!state.selection.empty) return false;
  const { from, $from } = state.selection;
  if (!$from.parent.isTextblock) return false;

  const blockStart = $from.start();
  const textBefore = state.doc.textBetween(blockStart, from, "\n");
  return /^\s*\/[a-zA-Z0-9]*$/.test(textBefore);
}

interface VisualEditorExtensionOptions {
  documentId?: string;
  ydoc?: YDoc | null;
  localAwareness?: Awareness | null;
  user?: {
    name: string;
    color: string;
    email?: string;
    avatarUrl?: string;
  } | null;
  onImageComment?: (quotedText: string, offsetTop: number) => void;
  onJoinTitle?: (text: string) => void;
  resolveNotionPageLink?: (notionPageId: string) => NotionPageLink | null;
  onOpenNotionPageLink?: (documentId: string) => void;
  localFilePath?: string | null;
  referenceDepth?: number;
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
  resolveNotionPageLink,
  onOpenNotionPageLink,
  localFilePath,
  referenceDepth = 0,
}: VisualEditorExtensionOptions = {}): Extensions {
  // Build on the SHARED editor core (StarterKit base + the Collaboration /
  // CollaborationCaret wiring + collab undo/redo gating + ordering), then inject
  // every Content-specific node/plugin as `extraExtensions`. Content owns its
  // own NFM serializer, Placeholder resolver, link/task/table nodes, and Notion
  // schema, so the shared factory's built-in Placeholder / Markdown / link /
  // tasks / tables / code block are turned off — only the StarterKit base and
  // the collab stack are reused. The NFM Markdown extension below stays
  // byte-identical to Content's existing config (html:true) so the
  // docToNfm/nfmToDoc round-trip is unchanged.
  return createSharedEditorExtensions({
    preset: "content",
    dialect: "nfm",
    features: {
      placeholder: false,
      markdown: false,
      link: false,
      tasks: false,
      tables: false,
      codeBlock: false,
    },
    starterKit: {
      blockquote: false,
      paragraph: false,
      horizontalRule: {},
      dropcursor: { color: false, width: 3, class: "notion-dropcursor" },
    },
    collab:
      ydoc || localAwareness ? { ydoc, awareness: localAwareness, user } : null,
    extraExtensions: [
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
      ...createNotionEditorExtensions({
        resolvePageLink: resolveNotionPageLink,
        onOpenPageLink: onOpenNotionPageLink,
      }),
      ...notionFidelityExtensions,
      // Core's generic registry-block atom node (`registryBlock`). Renders any
      // registered content block spec via the shared NodeView + side-map; content
      // sources block `data` lazily from the node's `__raw` NFM in
      // `VisualEditor` below. Mounted after the Notion nodes and before the
      // Markdown extension so the NFM <-> doc round-trip recognizes the node.
      RegistryBlockNode,
      LockedSourceComponentBlocks,
      ContentReferenceNode.configure({
        currentPath: localFilePath ?? null,
        referenceDepth,
      }),
      LocalMdxComponentNode,
      CommentHighlight,
      DragHandle,
      TypographyReplacements,
      NotionMarkdownShortcuts,
      MarkdownPasteDetection,
      SelectAllDocument,
      JoinFirstBodyBlockToTitle.configure({ onJoinTitle }),
      // Content's NFM Markdown config — kept exactly as before (html:true) so
      // tiptap-markdown's paste/copy transforms keep working. The authoritative
      // serialize/parse for save/load still goes through docToNfm / nfmToDoc.
      Markdown.configure({
        html: true,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
  });
}

/**
 * One cached registry block: its runtime `type` (resolved from the NFM source on
 * first parse) and its current typed `data`. `edited` marks blocks the author has
 * changed in this session, so the serializer re-emits them from `data` rather
 * than the node's stale `__raw`.
 */
interface RegistryBlockStoreEntry {
  type: string;
  base?: {
    title?: string;
    summary?: string;
    editable?: boolean;
  };
  data: unknown;
  edited: boolean;
}

function serializeRegistryBlockRaw(
  type: string,
  blockId: string,
  node: ProseMirrorNode,
  data: unknown,
  base?: RegistryBlockStoreEntry["base"],
): string {
  return serializeRegistryBlockToMdx(type, {
    id: blockId,
    title:
      typeof node.attrs.title === "string" ? node.attrs.title : base?.title,
    summary:
      typeof node.attrs.summary === "string"
        ? node.attrs.summary
        : base?.summary,
    editable: base?.editable,
    data,
  });
}

/**
 * A registry block is Notion-incompatible when its spec does NOT declare
 * `notionCompatible` — i.e. it is not in the registry's single
 * `notionCompatibleTypes()` allowlist (T3). The shared registry-block NodeView
 * consults this (only when the side-map's `notionSync` flag is on) to badge
 * blocks that won't survive a Notion push. Unknown types are treated as
 * incompatible so an unrecognized block is flagged rather than silently assumed
 * to sync.
 */
const NOTION_COMPATIBLE_BLOCK_TYPES =
  contentBlockRegistry.notionCompatibleTypes();
function isNotionIncompatibleBlockType(blockType: string): boolean {
  return !NOTION_COMPATIBLE_BLOCK_TYPES.has(blockType);
}

/**
 * Side-map store for the editor's `registryBlock` nodes.
 *
 * Content has NO sidecar block table — a registry block's authority is the inline
 * MDX in the single `documents.content` NFM string, preserved verbatim on each
 * node as `__raw`. The shared NodeView needs typed `data` to render, so this hook
 * lazily parses `__raw` (via the async `parseRegistryBlockData`) the first time a
 * block is rendered, caching the result keyed by blockId. An edit updates the
 * cache AND rewrites the node's `__raw` to the freshly serialized MDX, so the
 * existing NFM save path persists the change with no extra plumbing — `docToNfm`
 * emits `__raw` verbatim for every untouched-and-edited block alike, keeping the
 * single-string round-trip byte-exact.
 *
 * A document with no registry blocks never touches this store: `getBlock` is only
 * called from a mounted `registryBlock` NodeView, so the editor renders and
 * serializes identically to before.
 */
function useRegistryBlockStore(editor: CoreEditor | null) {
  const cacheRef = useRef<Map<string, RegistryBlockStoreEntry>>(new Map());
  const pendingRef = useRef<Set<string>>(new Set());
  // Bumping this state forces the NodeViews to re-read the cache once async
  // hydration (or an edit) lands. The `version` is surfaced to the side-map
  // value so the context reference changes on each bump — otherwise the Tiptap
  // NodeView (a separate React subtree reading the side-map through context)
  // never re-renders after the async `parseRegistryBlockData` resolves, leaving
  // a freshly-opened block stuck on its "Loading…" placeholder until some other
  // edit/HMR happens to re-render it.
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  // Find the live `registryBlock` node (and its position) for a blockId.
  const findNode = useCallback(
    (blockId: string): { pos: number; node: ProseMirrorNode } | null => {
      if (!editor || editor.isDestroyed) return null;
      let result: { pos: number; node: ProseMirrorNode } | null = null;
      editor.state.doc.descendants((node, pos) => {
        if (result) return false;
        if (
          node.type.name === "registryBlock" &&
          String(node.attrs.blockId ?? "") === blockId
        ) {
          result = { pos, node };
          return false;
        }
        return true;
      });
      return result;
    },
    [editor],
  );

  const getBlock = useCallback(
    (blockId: string): RegistryBlockSideMapBlock | undefined => {
      const found = findNode(blockId);
      if (!found) return undefined;
      const { node } = found;
      const title =
        typeof node.attrs.title === "string" ? node.attrs.title : undefined;
      const summary =
        typeof node.attrs.summary === "string" ? node.attrs.summary : undefined;

      const cached = cacheRef.current.get(blockId);
      if (cached) {
        return { id: blockId, title, summary, data: cached.data };
      }

      // Not hydrated yet: kick off a one-shot async parse of the verbatim MDX.
      const raw = typeof node.attrs.__raw === "string" ? node.attrs.__raw : "";
      if (raw && !pendingRef.current.has(blockId)) {
        pendingRef.current.add(blockId);
        void parseRegistryBlockData(raw)
          .then((parsed) => {
            if (parsed) {
              const existing = cacheRef.current.get(blockId);
              // A concurrent edit may have populated the cache first — don't
              // clobber it with the stale parse.
              if (!existing) {
                cacheRef.current.set(blockId, {
                  type: parsed.type,
                  base: parsed.base,
                  data: parsed.data,
                  edited: false,
                });

                // The core duplicate-id pass remints the node attr when a block
                // is pasted/duplicated, but content's persisted source is the
                // inline MDX stored in `__raw`. If the raw MDX still carries the
                // source id, refresh it now so the next normal editor update
                // persists the duplicate with its fresh id instead of writing a
                // second copy of the original id.
                if (parsed.base.id && parsed.base.id !== blockId) {
                  const live = findNode(blockId);
                  if (
                    live &&
                    typeof live.node.attrs.__raw === "string" &&
                    live.node.attrs.__raw === raw &&
                    editor &&
                    !editor.isDestroyed
                  ) {
                    try {
                      const refreshedRaw = serializeRegistryBlockRaw(
                        parsed.type,
                        blockId,
                        live.node,
                        parsed.data,
                        parsed.base,
                      );
                      const tr = editor.state.tr.setNodeMarkup(
                        live.pos,
                        undefined,
                        {
                          ...live.node.attrs,
                          blockType: parsed.type,
                          __raw: refreshedRaw,
                        },
                      );
                      editor.view.dispatch(tr);
                    } catch {
                      /* Keep the parsed cache; leave raw untouched if invalid. */
                    }
                  }
                }
                bump();
              }
            }
          })
          .catch(() => {
            /* Leave uncached; the NodeView keeps showing its placeholder. */
          })
          .finally(() => {
            pendingRef.current.delete(blockId);
          });
      }
      return undefined;
    },
    [editor, findNode, bump],
  );

  const onBlockDataChange = useCallback(
    (blockId: string, nextData: unknown) => {
      if (!editor || editor.isDestroyed) return;
      const found = findNode(blockId);
      if (!found) return;
      const { pos, node } = found;
      const prior = cacheRef.current.get(blockId);
      const type =
        prior?.type ||
        (typeof node.attrs.blockType === "string" ? node.attrs.blockType : "");
      if (!type) return;

      const base = prior?.base;
      cacheRef.current.set(blockId, {
        type,
        base,
        data: nextData,
        edited: true,
      });

      // Re-serialize the edited block to MDX and write it back onto the node's
      // `__raw`, so the existing NFM save path emits the new source verbatim.
      let raw: string;
      try {
        raw = serializeRegistryBlockRaw(type, blockId, node, nextData, base);
      } catch {
        // Unknown type or invalid data — keep the cache update so the UI reflects
        // the edit, but don't corrupt `__raw`.
        bump();
        return;
      }

      const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        __raw: raw,
      });
      tr.setMeta(LOCAL_FILE_USER_EDIT_META, true);
      editor.view.dispatch(tr);
      bump();
    },
    [editor, findNode, bump],
  );

  return useMemo(
    () => ({ getBlock, onBlockDataChange, version }),
    [getBlock, onBlockDataChange, version],
  );
}

export function VisualEditor({
  documentId,
  content,
  contentUpdatedAt,
  onChange,
  onSaveContent,
  ydoc,
  collabSynced = true,
  awareness,
  user,
  editable = true,
  localFileMode = false,
  localFilePath,
  referenceDepth,
  onComment,
  commentThreads,
  activeThreadId,
  pendingHighlight,
  onActivateThread,
  onJoinTitle,
  notionPageLinks = [],
  onOpenNotionPageLink,
  notionPageId,
}: VisualEditorProps) {
  const t = useT();
  const [isDraggingMedia, setIsDraggingMedia] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSaveContentRef = useRef(onSaveContent);
  onSaveContentRef.current = onSaveContent;
  const notionPageLinksRef = useRef(notionPageLinks);
  notionPageLinksRef.current = notionPageLinks;
  const resolveNotionPageLink = useCallback((notionPageId: string) => {
    const normalized = notionPageId.replace(/-/g, "").toLowerCase();
    return (
      notionPageLinksRef.current.find(
        (link) =>
          link.notionPageId === notionPageId ||
          link.notionPageId.replace(/-/g, "").toLowerCase() === normalized,
      ) ?? null
    );
  }, []);

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

  // Clean up awareness on unmount
  useEffect(() => {
    return () => {
      // Only the fallback instance is owned by this editor. A provided
      // awareness belongs to the shared useCollaborativeDoc connection; clearing
      // it here races StrictMode/remounts and can erase the tab's durable
      // presence while the shared connection is still active.
      fallbackAwareness?.setLocalState(null);
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
        resolveNotionPageLink,
        onOpenNotionPageLink,
        localFilePath,
        referenceDepth,
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
      resolveNotionPageLink,
      onOpenNotionPageLink,
      localFilePath,
      referenceDepth,
    ],
  );

  // The collab hook needs the editor, but useEditor's `onUpdate` needs the
  // hook's guards. Break the cycle with a ref: `onUpdate` reads the guards
  // through `guardsRef`, populated right after the hook runs below. `onUpdate`
  // only fires once the editor exists, by which point the ref holds the guards.
  const guardsRef = useRef<UseCollabReconcileResult | null>(null);
  const lastUserEditIntentAtRef = useRef(0);
  const markUserEditIntent = useCallback(() => {
    lastUserEditIntentAtRef.current = Date.now();
  }, []);
  const persistEditorContent = useCallback(
    (
      editorToPersist: CoreEditor,
      options?: { markdown?: string; immediate?: boolean },
    ) => {
      const guards = guardsRef.current;
      if (!guards) return false;
      try {
        const normalized =
          options?.markdown ?? docToNfm(editorToPersist.getJSON() as any);
        if (localFileMode && normalized === content) return true;
        if (options?.immediate && onSaveContentRef.current) {
          return onSaveContentRef.current(normalized);
        }
        // Don't persist an empty doc before Collaboration has seeded (would
        // clobber DB content with an empty string). `registerEmitted` records
        // this as the last-emitted value and returns false to skip the save.
        if (!guards.registerEmitted(normalized)) return true;
        setTimeout(() => onChangeRef.current(normalized), 0);
        return true;
      } catch (err: any) {
        toast.error(
          t("editor.markdownSerializationError", { message: err.message }),
        );
        console.error("Markdown serialization error:", err);
        return false;
      }
    },
    [content, localFileMode, t],
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
        if (view.editable) markUserEditIntent();
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
        if (view.editable) markUserEditIntent();
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
        beforeinput(view) {
          if (view.editable) markUserEditIntent();
          return false;
        },
        keydown(view) {
          if (view.editable) markUserEditIntent();
          return false;
        },
        cut(view) {
          if (view.editable) markUserEditIntent();
          return false;
        },
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
      const guards = guardsRef.current;
      // `shouldIgnoreUpdate` covers: not editable, mid-programmatic setContent,
      // and (collab) remote-origin transactions — the exact guards content used
      // inline before, now owned by the shared hook.
      if (!guards || guards.shouldIgnoreUpdate(transaction)) return;
      if (
        localFileMode &&
        transaction.getMeta(normalizeTableHeadersPluginKey)
      ) {
        return;
      }
      if (
        localFileMode &&
        !shouldPersistLocalFileEditorUpdate({
          docChanged: transaction.docChanged,
          editorFocused: editor.isFocused,
          explicitLocalFileUserEdit:
            transaction.getMeta(LOCAL_FILE_USER_EDIT_META) === true,
          recentUserEditIntent:
            Date.now() - lastUserEditIntentAtRef.current < 2000,
          transactionUiEvent: transaction.getMeta("uiEvent"),
        })
      ) {
        return;
      }
      if (isActiveSlashCommandDraft(editor)) return;
      persistEditorContent(editor);
    },
  });

  // The shared seed / reconcile / lead-client / onUpdate-guard logic, with
  // Content's NFM serializer injected so the editor reads/writes the exact same
  // bytes as before (docToNfm / nfmToDoc / canonicalizeNfm, and the
  // `<empty-block/>`-aware seed predicate). `initialAppliedUpdatedAt: null`
  // preserves Content's "first run reconciles a stale persisted Y.Doc against
  // authoritative SQL" behavior (an agent that edited the CLOSED doc).
  const collabState = useCollabReconcile({
    editor,
    ydoc,
    collabSynced,
    awareness: localAwareness,
    value: content,
    contentUpdatedAt,
    editable,
    getMarkdown: (e) => docToNfm(e.getJSON() as any),
    // Read-only viewers join the shared Y.Doc purely to RECEIVE live edits and
    // cursors; their editor content comes from the server state fetch + peer Yjs
    // updates, never from SQL reconcile. Any local Y.Doc write from a viewer
    // would be POSTed to the editor-only `/update` route (→ 403) and could
    // publish an author-less snapshot, so both write paths are neutered when
    // `!editable`: this `setContent` (used by both the seed and the reconcile
    // apply) no-ops, and `shouldSeed` returns false so the seed never runs.
    setContent: (e, value, options) => {
      if (!editable) return;
      const doc = nfmToDoc(value);
      if (options.addToHistory === false) {
        e.chain()
          .command(({ tr }) => {
            // addToHistory:false so cmd+z (or Yjs undo) doesn't erase
            // externally-loaded content.
            tr.setMeta("addToHistory", false);
            return true;
          })
          .setContent(doc, { emitUpdate: options.emitUpdate })
          .run();
        return;
      }
      e.commands.setContent(doc);
    },
    normalizeValue: canonicalizeNfm,
    // The shared fallback parser is CommonMark. Content stores canonical NFM,
    // whose adjacent lines are separate Notion blocks, so always provide the
    // exact NFM parser for the surgical reconcile path.
    parseValue: parseNfmForCollabReconcile,
    shouldSeed: ({ value, currentMarkdown, fragmentLength }) =>
      editable &&
      shouldSeedCollaborativeContent({
        content: value,
        currentMarkdown,
        fragmentLength,
      }),
    initialAppliedUpdatedAt: null,
  });
  guardsRef.current = collabState;

  // ─── Recent-edit highlights (Google-Docs / Figma "just edited this") ─────────
  //
  // Other participants — including the AI agent — publish a short ring of recent
  // edits into their awareness state. `usePresence` surfaces the remote entries,
  // `useRecentEdits` filters to the non-expired ones, and `RecentEditHighlights`
  // paints a lingering, fading glow with the editor's name/color flag. For the
  // agent, `edit-document` / `update-document` publish a `{ kind: "text", quote }`
  // descriptor, which we resolve to a viewport rect by locating the quote in the
  // live ProseMirror doc and measuring the span with `coordsAtPos`.
  const localClientId = ydoc?.clientID ?? null;
  const { others } = usePresence(localAwareness, localClientId);
  const recentEdits = useRecentEdits(others);

  const resolveRecentEditRect = useCallback(
    (edit: AttributedRecentEdit): DOMRect | null => {
      if (!editor || editor.isDestroyed) return null;
      if (edit.descriptor.kind !== "text") return null;
      const quote =
        typeof edit.descriptor.quote === "string"
          ? edit.descriptor.quote.trim()
          : "";
      if (!quote) return null;

      // Clamp very long quotes — matching a long exact string across the doc is
      // brittle (whitespace/markdown differences); the leading slice is enough to
      // anchor the highlight to the right region.
      const needle = quote.slice(0, 60);

      // Walk the doc's text, tracking absolute positions, to find the needle.
      const doc = editor.state.doc;
      let found: { from: number; to: number } | null = null;
      let acc = "";
      let accStart = -1;
      doc.descendants((node, pos) => {
        if (found) return false;
        if (!node.isText || typeof node.text !== "string") return true;
        if (accStart === -1) accStart = pos;
        acc += node.text;
        const idx = acc.indexOf(needle);
        if (idx !== -1) {
          const from = accStart + idx;
          found = { from, to: from + needle.length };
          return false;
        }
        // Keep only a tail long enough to catch a needle spanning two text nodes.
        if (acc.length > needle.length * 2) {
          const drop = acc.length - needle.length;
          acc = acc.slice(drop);
          accStart += drop;
        }
        return true;
      });
      if (!found) return null;

      try {
        const { from } = found;
        const start = editor.view.coordsAtPos(from);
        return getRecentEditPresenceMarkerRect(start);
      } catch {
        return null;
      }
    },
    [editor],
  );

  // Side-map that feeds the shared registry-block NodeView its typed `data`,
  // lazily parsed from each node's verbatim `__raw` NFM. Edits write the
  // re-serialized MDX back onto the node so the existing NFM save path persists
  // them. A document with no `registryBlock` nodes never touches this store.
  const registryBlockStore = useRegistryBlockStore(editor);
  const registryBlockDataValue = useMemo(
    () => ({
      editable,
      getBlock: registryBlockStore.getBlock,
      onBlockDataChange: registryBlockStore.onBlockDataChange,
      // When the document is linked to a Notion page, badge any present block
      // whose type has no NFM analog so the author sees what won't push. The
      // shared NodeView only consults `isNotionIncompatibleType` while
      // `notionSync` is on, so a non-linked document never badges anything.
      notionSync: !!notionPageId,
      isNotionIncompatibleType: isNotionIncompatibleBlockType,
    }),
    [editable, registryBlockStore, notionPageId],
  );

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(editable);
  }, [editor, editable]);

  // Resolve each open thread's stored anchor to a live range and push the
  // highlight specs into the CommentHighlight plugin. Reads threads through a
  // ref (the query returns a new array each poll) and re-runs on a cheap
  // signature so we don't thrash, while the plugin maps ranges through edits in
  // between so highlights track the text live.
  const threadsRef = useRef(commentThreads);
  threadsRef.current = commentThreads;
  const threadsSignature = useMemo(
    () =>
      (commentThreads ?? [])
        .map((t) => `${t.threadId}:${t.resolved ? 1 : 0}:${t.quotedText ?? ""}`)
        .join("|"),
    [commentThreads],
  );
  const pendingKey = pendingHighlight
    ? `${pendingHighlight.from}-${pendingHighlight.to}`
    : "";

  // Push the resolved highlight specs into the plugin. When `force` is false we
  // KEEP the positions of highlights the plugin is already tracking (so they
  // stay live-mapped while typing) and only resolve threads that are missing —
  // this is what establishes highlights after the collaborative doc seeds.
  // `force` re-resolves everything from scratch (used when the loaded content is
  // swapped wholesale by an agent / Notion pull).
  const applyHighlights = useCallback(
    (force: boolean) => {
      if (!editor || editor.isDestroyed) return;
      const view = editor.view;
      const current = commentHighlightKey.getState(view.state);
      const mapped = force
        ? new Map<string, CommentHighlightSpec>()
        : new Map((current?.specs ?? []).map((s) => [s.threadId, s]));
      const specs: CommentHighlightSpec[] = [];
      for (const thread of threadsRef.current ?? []) {
        if (thread.resolved) continue;
        const existing = mapped.get(thread.threadId);
        if (existing) {
          specs.push(existing);
          continue;
        }
        const range = resolveAnchor(view.state.doc, {
          quotedText: thread.quotedText,
          prefix: thread.prefix ?? undefined,
          suffix: thread.suffix ?? undefined,
          startOffset: thread.startOffset ?? undefined,
        });
        if (range) {
          specs.push({
            threadId: thread.threadId,
            from: range.from,
            to: range.to,
          });
        }
      }
      setCommentHighlights(view, {
        specs,
        pending: pendingHighlight ?? null,
        activeId: activeThreadId ?? null,
      });
    },
    [editor, pendingHighlight?.from, pendingHighlight?.to, activeThreadId],
  );

  const applyRef = useRef(applyHighlights);
  applyRef.current = applyHighlights;
  // Coalesce with a macrotask rather than requestAnimationFrame: rAF is throttled
  // in background/unfocused tabs, which would stall highlight updates whenever
  // the document isn't the foreground tab.
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scheduleApply = useCallback((force: boolean) => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => applyRef.current(force), 0);
  }, []);
  useEffect(() => () => clearTimeout(timerRef.current), []);

  // Establish highlights when the thread set changes. The collaborative doc
  // seeds asynchronously AND the seed is applied with `emitUpdate: false`, so we
  // can neither resolve once on mount (the doc may still be empty) nor rely on
  // an editor "update" event firing. Instead poll on a short interval, keeping
  // already-tracked ranges and filling in missing ones each pass, until every
  // open thread is established (or we give up after a few seconds for anchors
  // whose text no longer exists). Idempotent once everything is in place.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    let stopped = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (stopped || editor.isDestroyed) return;
      applyRef.current(false);
      attempts += 1;
      const present = new Set(
        (commentHighlightKey.getState(editor.view.state)?.specs ?? []).map(
          (s) => s.threadId,
        ),
      );
      const allPresent = (threadsRef.current ?? [])
        .filter((t) => !t.resolved)
        .every((t) => present.has(t.threadId));
      if (!allPresent && attempts < 25) timer = setTimeout(tick, 150);
    };
    timer = setTimeout(tick, 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [editor, threadsSignature]);

  // Active card / pending selection just update the existing highlights.
  useEffect(() => {
    scheduleApply(false);
  }, [editor, scheduleApply, activeThreadId, pendingKey]);

  // Re-resolve from scratch when the loaded content changes wholesale (an agent
  // edit / Notion pull replaces the document body).
  useEffect(() => {
    scheduleApply(true);
  }, [editor, scheduleApply, content, contentUpdatedAt]);

  // Clicking an inline highlight focuses its thread in the sidebar.
  useEffect(() => {
    if (!editor || editor.isDestroyed || !onActivateThread) return;
    const dom = editor.view.dom;
    const handleClick = (event: Event) => {
      const target = event.target as HTMLElement | null;
      const el = target?.closest?.(
        "[data-comment-thread]",
      ) as HTMLElement | null;
      if (!el) return;
      const id = el.getAttribute("data-comment-thread");
      if (id) setTimeout(() => onActivateThread(id), 0);
    };
    dom.addEventListener("click", handleClick);
    return () => dom.removeEventListener("click", handleClick);
  }, [editor, onActivateThread]);

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
      ref={wrapperRef}
      className={`visual-editor-wrapper${isDraggingMedia ? " visual-editor-wrapper--dragging" : ""}`}
    >
      <RecentEditHighlights
        edits={recentEdits}
        resolveRect={resolveRecentEditRect}
        containerRef={wrapperRef}
        ttlMs={CONTENT_RECENT_EDIT_TTL_MS}
      />
      {editable ? (
        <BubbleToolbar editor={editor} onComment={onComment} />
      ) : null}
      {editable ? (
        <SlashCommandMenu
          editor={editor}
          documentId={documentId}
          notionPageId={notionPageId}
          onDraftCommitted={() => {
            void persistEditorContent(editor);
          }}
          onDraftPersisted={(markdown) =>
            persistEditorContent(editor, { markdown, immediate: true })
          }
        />
      ) : null}
      <LinkHoverPreview editor={editor} editable={editable} />
      {editable ? <TableHoverControls editor={editor} /> : null}
      {editable && isDraggingMedia ? (
        <div className="media-drop-overlay">
          <div className="media-drop-overlay__content">
            <IconPhoto size={16} />
            <IconVideo size={16} />
            <IconMusic size={16} />
            <span>{t("editor.dropMedia")}</span>
          </div>
        </div>
      ) : null}
      <RegistryBlockDataProvider value={registryBlockDataValue}>
        <EditorContent editor={editor} />
      </RegistryBlockDataProvider>
    </div>
  );
}
