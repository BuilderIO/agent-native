import {
  useEditor,
  EditorContent,
  Extension,
  Node as TiptapNode,
  mergeAttributes,
} from "@tiptap/react";
import type { Editor as CoreEditor, Extensions } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
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
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
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
import { DragHandle } from "./extensions/DragHandle";
import { CodeBlock } from "./extensions/CodeBlockNode";
import { toast } from "sonner";
import {
  parseNfmForEditor,
  serializeEditorToNfm,
} from "@shared/notion-markdown";
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
const NotionBlockIndent = Extension.create({
  name: "notionBlockIndent",
  priority: 50,
  addKeyboardShortcuts() {
    const inHandled = (editor: any) =>
      editor.isActive("listItem") ||
      editor.isActive("taskItem") ||
      editor.isActive("tableCell") ||
      editor.isActive("tableHeader") ||
      editor.isActive("codeBlock");

    return {
      Tab: ({ editor }) => {
        if (inHandled(editor)) return false;
        return editor.chain().focus().wrapIn("blockquote").run();
      },
      "Shift-Tab": ({ editor }) => {
        if (inHandled(editor)) return false;
        if (!editor.isActive("blockquote")) return false;
        return editor.chain().focus().lift("blockquote").run();
      },
    };
  },
});

const CustomTable = BaseTable.extend({
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

interface VisualEditorProps {
  documentId?: string;
  content: string;
  onChange: (markdown: string) => void;
  /** Yjs document for collaborative editing. */
  ydoc?: YDoc | null;
  /** Current user info for cursor labels. */
  user?: { name: string; color: string };
  editable?: boolean;
  /** Called when user selects text and clicks "Comment" in bubble toolbar. */
  onComment?: (quotedText: string, offsetTop: number) => void;
  onJoinTitle?: (text: string) => void;
}

interface VisualEditorExtensionOptions {
  ydoc?: YDoc | null;
  localAwareness?: Awareness | null;
  user?: { name: string; color: string } | null;
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
      onImageComment,
    }),
    VideoNode.configure({
      HTMLAttributes: { class: "notion-video" },
      onVideoComment: onImageComment,
    }),
    AudioNode.configure({
      HTMLAttributes: { class: "notion-audio" },
      onAudioComment: onImageComment,
    }),
    CustomTable.configure({
      resizable: false,
      HTMLAttributes: { class: "notion-table" },
    }),
    TableRow,
    TableHeader,
    TableCell,
    ...notionEditorExtensions,
    DragHandle,
    TypographyReplacements,
    NotionMarkdownShortcuts,
    MarkdownPasteDetection,
    SelectAllDocument,
    JoinFirstBodyBlockToTitle.configure({ onJoinTitle }),
    NotionBlockIndent,
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
  onChange,
  ydoc,
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
  // distinguish external SQL changes (Notion pull) from our own saves.
  const lastEmittedRef = useRef<string>("");
  // Tracks the last time the user actually typed (not just had focus). The
  // focus guard in the content-sync effect uses this so a Notion pull or
  // agent edit can still apply when the user is idle but happens to have
  // the editor focused — without yanking in-progress typing.
  const lastTypedAtRef = useRef<number>(0);

  // Create Awareness instance locally (same module as CollaborationCursor uses)
  const localAwareness = useMemo(() => {
    if (!ydoc) return null;
    const a = new Awareness(ydoc);
    if (user) {
      a.setLocalStateField("user", user);
    }
    return a;
  }, [ydoc]);

  // Update user info when it changes
  useEffect(() => {
    if (localAwareness && user) {
      localAwareness.setLocalStateField("user", user);
    }
  }, [localAwareness, user?.name, user?.color]);

  // Clean up awareness on unmount
  useEffect(() => {
    return () => {
      localAwareness?.destroy();
    };
  }, [localAwareness]);

  const extensions = useMemo(
    () =>
      createVisualEditorExtensions({
        ydoc,
        localAwareness,
        user,
        onImageComment: onComment,
        onJoinTitle,
      }),
    [ydoc, localAwareness, user?.name, user?.color, onComment, onJoinTitle],
  );

  const editor = useEditor({
    extensions,
    content: parseNfmForEditor(content),
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
    onUpdate: ({ editor }) => {
      if (isSettingContent.current) return;
      lastTypedAtRef.current = Date.now();
      try {
        const md = (editor.storage as any).markdown.getMarkdown();
        const normalized = serializeEditorToNfm(md);
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
    const fragment = ydoc.getXmlFragment("default");
    if (fragment.length === 0) {
      isSettingContent.current = true;
      editor.commands.setContent(parseNfmForEditor(content));
      isSettingContent.current = false;
    }
    seededDocRef.current = documentId ?? null;
  }, [editor, ydoc, content, documentId]);

  // Sync content from outside (e.g. Notion pull, update-document action).
  // When ydoc is bound, applying content through the editor via setContent
  // propagates through TipTap's Collaboration extension to Y.XmlFragment,
  // which then flows to the server and other clients via the collab update
  // channel. We detect echoes of our own saves via lastEmittedRef to avoid
  // clobbering user edits in progress.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const docChanged = documentId !== prevDocIdRef.current;
    if (docChanged) prevDocIdRef.current = documentId;
    const nextEditorContent = parseNfmForEditor(content);
    const currentMd = serializeEditorToNfm(
      (editor.storage as any).markdown.getMarkdown(),
    );
    const normalizedNext = serializeEditorToNfm(nextEditorContent);
    if (currentMd === normalizedNext) return;

    // If the incoming content matches what we just emitted, it's our own
    // save echoing back via the poll — skip to avoid a needless re-render.
    if (content === lastEmittedRef.current) return;

    // Skip sync while the user is actively typing (unless the doc switched)
    // so we don't yank their in-progress edits. We only block if the user
    // has TYPED in the last 2s — having focus alone isn't enough, otherwise
    // a Notion pull that happens while the user has the editor focused but
    // idle would leave them stuck on the pre-pull content.
    const typedRecently = Date.now() - lastTypedAtRef.current < 2000;
    if (editor.isFocused && typedRecently && !docChanged) return;

    // Defer to a microtask so we don't trigger flushSync during a React
    // render — TipTap's setContent dispatches PM transactions that may
    // synchronously update React-owned state via the Collaboration extension.
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || !editor || editor.isDestroyed) return;
      isSettingContent.current = true;
      // Use addToHistory: false so cmd+z doesn't erase loaded content.
      // External content changes (load, sync) should never be undoable.
      editor
        .chain()
        .command(({ tr }) => {
          tr.setMeta("addToHistory", false);
          return true;
        })
        .setContent(nextEditorContent)
        .run();
      isSettingContent.current = false;
    });
    return () => {
      cancelled = true;
    };
  }, [content, editor, documentId, ydoc]);

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
