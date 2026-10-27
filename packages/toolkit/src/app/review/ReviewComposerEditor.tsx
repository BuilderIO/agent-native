import type { ReviewMention } from "@agent-native/core/review/types";
import Placeholder from "@tiptap/extension-placeholder";
import type { NodeType } from "@tiptap/pm/model";
import { Selection, TextSelection } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type Ref,
} from "react";

import {
  parseReviewComposerText,
  REVIEW_MENTION_NODE_NAME,
  reviewMentionLeafText,
  serializeReviewComposerDoc,
} from "./ReviewComposerText.js";
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
  splitBlock: () => void;
}

export interface ReviewComposerEditorProps {
  value: string;
  mentions: readonly ReviewMention[];
  placeholder?: string;
  disabled?: boolean;
  attributes?: Record<string, string>;
  className?: string;
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
    className,
    onTextChange,
    onCaretChange,
    onKeyDown,
    onReady,
  }: ReviewComposerEditorProps,
  ref: Ref<ReviewComposerEditorHandle>,
) {
  const latest = useRef({
    placeholder,
    onTextChange,
    onCaretChange,
    onKeyDown,
    onReady,
  });
  latest.current = {
    placeholder,
    onTextChange,
    onCaretChange,
    onKeyDown,
    onReady,
  };

  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    content: parseReviewComposerText(value, mentions),
    extensions: [
      StarterKit.configure({
        blockquote: false,
        bold: false,
        bulletList: false,
        code: false,
        codeBlock: false,
        dropcursor: false,
        gapcursor: false,
        hardBreak: false,
        heading: false,
        horizontalRule: false,
        italic: false,
        link: false,
        listItem: false,
        listKeymap: false,
        orderedList: false,
        strike: false,
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
        ...attributes,
        ...(className ? { class: className } : {}),
      },
      handleKeyDown: (_view, event) => {
        if (latest.current.onKeyDown?.(event)) return true;
        if (
          event.key === "Enter" &&
          event.shiftKey &&
          !event.isComposing &&
          event.keyCode !== 229
        ) {
          event.preventDefault();
          editorRef.current?.commands.splitBlock();
          return true;
        }
        return false;
      },
    },
    onCreate: () => latest.current.onReady?.(),
    onUpdate: ({ editor: instance, transaction }) => {
      if (transaction.getMeta(SILENT_META)) return;
      latest.current.onTextChange(
        serializeReviewComposerDoc(instance.state.doc),
      );
      latest.current.onCaretChange?.();
    },
    onSelectionUpdate: () => latest.current.onCaretChange?.(),
  });
  const editorRef = useRef(editor);
  editorRef.current = editor;

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
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
        return serializeReviewComposerDoc(tr.doc);
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
      splitBlock: () => {
        editorRef.current?.commands.splitBlock();
      },
    }),
    [],
  );

  return <EditorContent editor={editor} />;
});
