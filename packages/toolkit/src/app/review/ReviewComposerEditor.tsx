import type { ReviewMention } from "@agent-native/core/review/types";
import Placeholder from "@tiptap/extension-placeholder";
import { Slice, type NodeType } from "@tiptap/pm/model";
import { Selection, TextSelection } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";

import { isComposingKey } from "./comment-send-key.js";
import {
  parseReviewComposerText,
  REVIEW_MENTION_NODE_NAME,
  reviewMentionLeafText,
  serializeReviewComposerDoc,
} from "./ReviewComposerText.js";
import {
  ReviewComposerToolbar,
  type ReviewComposerFormatLabels,
} from "./ReviewComposerToolbar.js";
import { ReviewMentionNode } from "./ReviewMentionChip.js";

const SILENT_META = "reviewComposerSilent";
// Leaf nodes are one position wide, so one character per chip keeps string
// offsets and document positions the same.
const CHIP_PLACEHOLDER = "￼";
const MENTION_TRIGGER = /(?:^|[^\p{L}\p{M}\p{N}_])@([^\s@]*)$/u;

export interface ReviewComposerMentionTrigger {
  /** Document position of the `@`. */
  from: number;
  /** Text typed between the `@` and the caret. */
  query: string;
}

export interface ReviewComposerEditorHandle {
  focus: (position?: "end" | "keep") => boolean;
  /** Inserts at the caret, spacing it off a preceding word. */
  insertText: (text: string) => void;
  /** Replaces the selection with `text` exactly as given. */
  typeText: (text: string) => void;
  /** Swaps `[from, caret]` for a mention chip and returns the new body. */
  insertMention: (mention: ReviewMention, from: number) => string | null;
  getMentionTrigger: () => ReviewComposerMentionTrigger | null;
  /** Everything before the caret as the body string, chips as `@label`. */
  getTextBeforeCaret: () => string;
  /** Starts a new line, list item or code line, as Enter does in a document. */
  splitBlock: () => void;
  /** Whether the caret is in a list or code block, where Enter goes on with it. */
  enterContinuesBlock: () => boolean;
  /** Whether the caret is in code, where `@` is only a character. */
  isInCode: () => boolean;
}

/**
 * What the editor tells assistive technology about the mention list it drives.
 * DOM focus stays in the editor, so the highlighted option is named through
 * `activeDescendant` rather than by moving focus. The editor is a
 * `role="textbox"`, which does not allow `aria-expanded` or `aria-haspopup`;
 * whether the list is open shows only through `controls`.
 */
export interface ReviewComposerEditorCombobox {
  /** The listbox id, while it is open. */
  controls?: string | undefined;
  /** The highlighted option id, while the list is open. */
  activeDescendant?: string | undefined;
}

const COMBOBOX_ATTRIBUTES = [
  "aria-autocomplete",
  "aria-controls",
  "aria-activedescendant",
] as const;

export interface ReviewComposerEditorProps {
  value: string;
  mentions: readonly ReviewMention[];
  placeholder?: string;
  disabled?: boolean;
  attributes?: Record<string, string>;
  /** Omit when the field has no list; the editor is then a plain textbox. */
  combobox?: ReviewComposerEditorCombobox | undefined;
  className?: string;
  formatLabels?: Partial<ReviewComposerFormatLabels> | undefined;
  /** User edits only; programmatic changes to `value` never call this. */
  onTextChange: (text: string) => void;
  onCaretChange?: () => void;
  /** Return true to stop the editor handling the key. */
  onKeyDown?: (event: KeyboardEvent) => boolean;
  onReady?: () => void;
}

export const ReviewComposerEditor = forwardRef(function ReviewComposerEditor(
  {
    value,
    mentions,
    placeholder,
    disabled = false,
    attributes,
    combobox,
    className,
    formatLabels,
    onTextChange,
    onCaretChange,
    onKeyDown,
    onReady,
  }: ReviewComposerEditorProps,
  ref: Ref<ReviewComposerEditorHandle>,
) {
  const latest = useRef({
    placeholder,
    mentions,
    onTextChange,
    onCaretChange,
    onKeyDown,
    onReady,
  });
  latest.current = {
    placeholder,
    mentions,
    onTextChange,
    onCaretChange,
    onKeyDown,
    onReady,
  };
  // The body the editor last said it holds, or was last given. A `value` equal
  // to it is the editor's own, so it never resets the editor and its caret.
  const lastValueRef = useRef(value);
  // True while Shift+Enter replays Enter through the editor's own keymaps, so
  // the host's Enter (send) stays out of it.
  const replayingEnterRef = useRef(false);
  // The link field's text while it's open.
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const openLinkField = () => {
    const instance = editorRef.current;
    if (!instance || instance.isDestroyed || !instance.isEditable) return;
    const href: unknown = instance.getAttributes("link").href;
    setLinkDraft(typeof href === "string" ? href : "");
  };
  const pressEnter = () => {
    const instance = editorRef.current;
    if (!instance || instance.isDestroyed) return;
    replayingEnterRef.current = true;
    try {
      instance.commands.keyboardShortcut("Enter");
    } finally {
      replayingEnterRef.current = false;
    }
  };

  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    content: parseReviewComposerText(value, mentions),
    // Copied text keeps its lines, the way a paste of it reads them.
    coreExtensionOptions: { clipboardTextSerializer: { blockSeparator: "\n" } },
    // A paste reads Markdown once, below. Paste rules would also bold the
    // asterisks in a page's text, or in text pasted as plain.
    enablePasteRules: false,
    extensions: [
      // What a comment can show: bold, italic, struck, code and links, with
      // lists, quotes and code blocks. Markdown typed as you go formats.
      StarterKit.configure({
        dropcursor: false,
        gapcursor: false,
        hardBreak: false,
        heading: false,
        horizontalRule: false,
        link: {
          openOnClick: false,
          autolink: true,
          linkOnPaste: true,
          defaultProtocol: "https",
          HTMLAttributes: { rel: "noopener noreferrer nofollow", target: null },
        },
        trailingNode: false,
        underline: false,
      }),
      Placeholder.configure({
        placeholder: () => latest.current.placeholder ?? "",
        emptyEditorClass: "is-editor-empty",
        showOnlyCurrent: false,
        showOnlyWhenEditable: false,
      }),
      ReviewMentionNode,
    ],
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        // Cmd/Ctrl+K links here; the app's command menu leaves it alone.
        "data-command-menu-shortcut": "own",
        ...attributes,
        ...(className ? { class: className } : {}),
      },
      handleKeyDown: (_view, event) => {
        if (replayingEnterRef.current) return false;
        if (latest.current.onKeyDown?.(event)) return true;
        if (isComposingKey(event)) return false;
        if (event.key === "Enter" && event.shiftKey) {
          event.preventDefault();
          pressEnter();
          return true;
        }
        if (
          (event.metaKey || event.ctrlKey) &&
          !event.altKey &&
          !event.shiftKey &&
          event.key.toLowerCase() === "k"
        ) {
          // The box's own shortcut, not the page's.
          event.preventDefault();
          event.stopPropagation();
          openLinkField();
          return true;
        }
        return false;
      },
      // Pasted text reads as the Markdown it shows as; Shift pastes it as
      // plain lines. Rich text from a page comes as HTML and skips this.
      clipboardTextParser: (text, _context, plain, view) => {
        const doc = plain
          ? plainLinesDoc(text)
          : parseReviewComposerText(text, latest.current.mentions);
        return Slice.maxOpen(view.state.schema.nodeFromJSON(doc).content);
      },
    },
    onCreate: () => latest.current.onReady?.(),
    onUpdate: ({ editor: instance, transaction }) => {
      if (transaction.getMeta(SILENT_META)) return;
      const text = serializeReviewComposerDoc(instance.state.doc);
      lastValueRef.current = text;
      latest.current.onTextChange(text);
      latest.current.onCaretChange?.();
    },
    onSelectionUpdate: () => latest.current.onCaretChange?.(),
  });
  const editorRef = useRef(editor);
  editorRef.current = editor;

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (value === lastValueRef.current) return;
    lastValueRef.current = value;
    if (serializeReviewComposerDoc(editor.state.doc) === value) return;
    editor
      .chain()
      .setContent(parseReviewComposerText(value, mentions), {
        emitUpdate: false,
      })
      .command(({ tr }) => {
        tr.setSelection(Selection.atEnd(tr.doc));
        return true;
      })
      .run();
  }, [editor, value, mentions]);

  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.setEditable(!disabled, false);
  }, [editor, disabled]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const dom = editor.view.dom;
    for (const [name, attribute] of Object.entries(attributes ?? {})) {
      dom.setAttribute(name, attribute);
    }
  }, [editor, attributes]);

  const comboboxEnabled = combobox !== undefined;
  const comboboxControls = combobox?.controls;
  const comboboxActiveDescendant = combobox?.activeDescendant;
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const dom = editor.view.dom;
    const next: Record<string, string | undefined> = comboboxEnabled
      ? {
          "aria-autocomplete": "list",
          "aria-controls": comboboxControls,
          "aria-activedescendant": comboboxActiveDescendant,
        }
      : {};
    // Set on the live node rather than through `editorProps`, which would
    // need a ProseMirror transaction to refresh and can only add attributes.
    for (const name of COMBOBOX_ATTRIBUTES) {
      const attribute = next[name];
      if (attribute === undefined) dom.removeAttribute(name);
      else dom.setAttribute(name, attribute);
    }
  }, [editor, comboboxEnabled, comboboxControls, comboboxActiveDescendant]);

  useImperativeHandle(
    ref,
    () => ({
      focus: (position = "end") => {
        const instance = editorRef.current;
        if (!instance || instance.isDestroyed) return false;
        if (position === "end") instance.commands.focus("end");
        else instance.view.focus();
        return instance.view.hasFocus();
      },
      insertText: (text) => {
        const instance = editorRef.current;
        if (!instance || instance.isDestroyed) return;
        const { state, view } = instance;
        const before = state.doc.textBetween(
          0,
          state.selection.from,
          "\n",
          reviewMentionLeafText,
        );
        const separator = before && !/\s$/.test(before) ? " " : "";
        view.dispatch(state.tr.insertText(`${separator}${text}`));
        view.focus();
      },
      typeText: (text) => {
        const instance = editorRef.current;
        if (!instance || instance.isDestroyed) return;
        const { state, view } = instance;
        view.dispatch(state.tr.insertText(text));
        view.focus();
      },
      insertMention: (mention, from) => {
        const instance = editorRef.current;
        if (!instance || instance.isDestroyed) return null;
        const { state, view } = instance;
        // A schema without the chip node is a bug, not "no mention to insert".
        const nodeTypes: Record<string, NodeType | undefined> =
          state.schema.nodes;
        const nodeType = nodeTypes[REVIEW_MENTION_NODE_NAME];
        if (!nodeType) throw new Error("Composer schema has no mention node");
        const tr = state.tr.replaceWith(
          from,
          state.selection.to,
          nodeType.create({
            label: mention.label,
            email: mention.email ?? null,
            id: mention.id ?? null,
          }),
        );
        tr.setSelection(TextSelection.create(tr.doc, from + 1));
        tr.setMeta(SILENT_META, true);
        view.dispatch(tr);
        view.focus();
        const text = serializeReviewComposerDoc(tr.doc);
        lastValueRef.current = text;
        return text;
      },
      getMentionTrigger: () => {
        const instance = editorRef.current;
        if (!instance || instance.isDestroyed) return null;
        const { $from, from } = instance.state.selection;
        const blockText = instance.state.doc.textBetween(
          $from.start(),
          from,
          "\n",
          CHIP_PLACEHOLDER,
        );
        const match = MENTION_TRIGGER.exec(blockText);
        if (!match) return null;
        const query = match.at(1);
        if (query === undefined)
          throw new Error("MENTION_TRIGGER must capture the typed query");
        return { from: from - query.length - 1, query };
      },
      getTextBeforeCaret: () => {
        const instance = editorRef.current;
        if (!instance || instance.isDestroyed) return "";
        return instance.state.doc.textBetween(
          0,
          instance.state.selection.from,
          "\n",
          reviewMentionLeafText,
        );
      },
      splitBlock: pressEnter,
      enterContinuesBlock: () => {
        const instance = editorRef.current;
        if (!instance || instance.isDestroyed) return false;
        return instance.isActive("listItem") || instance.isActive("codeBlock");
      },
      isInCode: () => {
        const instance = editorRef.current;
        if (!instance || instance.isDestroyed) return false;
        return instance.isActive("codeBlock") || instance.isActive("code");
      },
    }),
    [],
  );

  return (
    <>
      <EditorContent editor={editor} />
      <ReviewComposerToolbar
        editor={editor}
        labels={formatLabels}
        linkDraft={linkDraft}
        onLinkDraftChange={setLinkDraft}
        onOpenLink={openLinkField}
      />
    </>
  );
});

/** Text as its lines, each kept as typed. */
function plainLinesDoc(text: string) {
  return {
    type: "doc",
    content: text
      .split(/\r\n?|\n/)
      .map((line) =>
        line
          ? { type: "paragraph", content: [{ type: "text", text: line }] }
          : { type: "paragraph" },
      ),
  };
}
