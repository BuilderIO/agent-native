import type { Extension, Node, Mark } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import type { StarterKitOptions } from "@tiptap/starter-kit";
import { useEffect, useMemo, useRef } from "react";
import type { Awareness } from "y-protocols/awareness";
import type { Doc as YDoc } from "yjs";

import { cn } from "../utils.js";
import { BubbleToolbar, type BubbleToolbarItem } from "./BubbleToolbar.js";
import { DragHandle } from "./DragHandle.js";
import {
  createSharedEditorExtensions,
  type RichMarkdownDialect,
  type RichMarkdownEditorPreset,
  type RichMarkdownCollabUser,
  type SharedEditorFeatures,
} from "./extensions.js";
import type { ImageUploadFn } from "./ImageExtension.js";
import {
  DEFAULT_SLASH_COMMANDS,
  filterSlashCommandItems,
  SlashCommandMenu,
  type SlashCommandItem,
} from "./SlashCommandMenu.js";
import {
  useCollabReconcile,
  getEditorMarkdown,
  type UseCollabReconcileResult,
  type UseCollabReconcileOptions,
} from "./useCollabReconcile.js";

export interface SharedRichEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  onBlur?: () => void;
  contentUpdatedAt?: string | null;
  editable?: boolean;
  dialect?: RichMarkdownDialect;
  preset?: RichMarkdownEditorPreset;
  features?: SharedEditorFeatures;
  dragHandle?: boolean;
  onImageUpload?: ImageUploadFn | null;
  extraExtensions?: Array<Extension | Node | Mark>;
  placeholder?: string;
  className?: string;
  editorClassName?: string;
  ariaLabel?: string;
  interactive?: boolean;
  ydoc?: YDoc | null;
  collabSynced?: boolean;
  awareness?: Awareness | null;
  user?: RichMarkdownCollabUser | null;
  disableHistory?: boolean;
  starterKit?: Partial<StarterKitOptions>;
  slashItems?: SlashCommandItem[];
  buildBubbleItems?: (
    editor: import("@tiptap/react").Editor,
    toggleLink: () => void,
  ) => BubbleToolbarItem[];
  getMarkdown?: (editor: import("@tiptap/react").Editor) => string;
  setContent?: (
    editor: import("@tiptap/react").Editor,
    value: string,
    options: { emitUpdate?: boolean; addToHistory?: boolean },
  ) => void;
  parseValue?: UseCollabReconcileOptions["parseValue"];
  normalizeValue?: (value: string) => string;
  shouldSeed?: (info: {
    value: string;
    currentMarkdown: string;
    fragmentLength: number;
  }) => boolean;
  initialAppliedUpdatedAt?: string | null;
  wrapperClassName?: string;
  onEditorReady?: (editor: import("@tiptap/react").Editor) => void;
  unstyled?: boolean;
}

export function SharedRichEditor({
  value,
  onChange,
  onBlur,
  contentUpdatedAt,
  editable = true,
  dialect = "gfm",
  preset = "plan",
  features,
  dragHandle = true,
  onImageUpload = null,
  extraExtensions,
  placeholder = "Type '/' for commands...",
  className,
  editorClassName,
  ariaLabel,
  interactive = editable,
  ydoc = null,
  collabSynced = true,
  awareness = null,
  user = null,
  disableHistory = false,
  starterKit,
  slashItems,
  buildBubbleItems,
  getMarkdown,
  setContent,
  parseValue,
  normalizeValue,
  shouldSeed,
  initialAppliedUpdatedAt,
  wrapperClassName,
  onEditorReady,
  unstyled = false,
}: SharedRichEditorProps) {
  const readMarkdown = getMarkdown ?? getEditorMarkdown;
  const onChangeRef = useRef(onChange);
  const onBlurRef = useRef(onBlur);
  onChangeRef.current = onChange;
  onBlurRef.current = onBlur;

  const effectiveExtraExtensions = useMemo(() => {
    const extras = extraExtensions ?? [];
    if (
      !dragHandle ||
      extras.some((extension) => extension.name === "dragHandle")
    ) {
      return extras;
    }

    return [
      DragHandle.configure({
        wrapperSelector: ".an-rich-md-wrapper",
      }),
      ...extras,
    ];
  }, [dragHandle, extraExtensions]);

  const extensions = useMemo(
    () =>
      createSharedEditorExtensions({
        dialect,
        preset,
        placeholder,
        features,
        extraExtensions: effectiveExtraExtensions,
        onImageUpload,
        collab: ydoc ? { ydoc, awareness, user } : null,
        disableHistory,
        starterKit,
      }),
    [
      dialect,
      placeholder,
      preset,
      features,
      effectiveExtraExtensions,
      onImageUpload,
      ydoc,
      awareness,
      user?.name,
      user?.email,
      user?.color,
      disableHistory,
      starterKit,
    ],
  );

  const collab = !!ydoc;

  const effectiveSlashItems = useMemo(
    () =>
      filterSlashCommandItems(slashItems ?? DEFAULT_SLASH_COMMANDS, features),
    [features, slashItems],
  );

  const guardsRef = useRef<UseCollabReconcileResult | null>(null);

  const editor = useEditor(
    {
      extensions,
      content: collab || setContent ? null : value,
      editable,
      editorProps: {
        attributes: {
          class: cn(
            unstyled ? "an-rich-md-unstyled" : "an-rich-md-prose",
            editorClassName,
          ),
          ...(ariaLabel ? { role: "textbox", "aria-label": ariaLabel } : {}),
        },
      },
      onUpdate: ({ editor, transaction }) => {
        const guards = guardsRef.current;
        if (!guards || guards.shouldIgnoreUpdate(transaction)) return;
        try {
          const markdown = readMarkdown(editor);
          if (!guards.registerEmitted(markdown)) return;
          queueMicrotask(() => onChangeRef.current(markdown));
        } catch (error) {
          console.error("Markdown serialization error:", error);
        }
      },
      onBlur: () => {
        onBlurRef.current?.();
      },
      // Recreate the editor when the shared Y.Doc identity changes — including
      // null → doc. Extensions are baked in at creation, so a ydoc that arrives
      // AFTER the first mount (fresh page load: the session/user resolves after
      // the editor mounts) would otherwise never bind Collaboration: the editor
      // looks fine but produces no Yjs updates and never receives peers' edits.
    },
    [ydoc],
  );

  const collabState = useCollabReconcile({
    editor,
    ydoc,
    collabSynced,
    awareness,
    value,
    contentUpdatedAt,
    editable,
    getMarkdown: readMarkdown,
    setContent,
    parseValue,
    normalizeValue,
    shouldSeed,
    initialAppliedUpdatedAt,
  });
  guardsRef.current = collabState;

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(editable);
  }, [editable, editor]);

  useEffect(() => {
    if (editor) onEditorReady?.(editor);
  }, [editor, onEditorReady]);

  useEffect(() => () => editor?.destroy(), [editor]);

  const handleWrapperClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!editable || !editor || editor.isDestroyed) return;
    const target = event.target as HTMLElement;
    if (
      target.classList.contains("an-rich-md-wrapper") ||
      target.classList.contains("an-rich-md-clickable")
    ) {
      editor.chain().focus("end").run();
    }
  };

  if (!editor) {
    return (
      <div
        className={cn(
          "an-rich-md-wrapper an-rich-md-loading",
          unstyled && "an-rich-md-wrapper--unstyled",
          className,
        )}
        data-plan-interactive={interactive ? true : undefined}
      />
    );
  }

  return (
    <div
      className={cn(
        "an-rich-md-wrapper an-rich-md-clickable",
        !editable && "an-rich-md-wrapper--readonly",
        unstyled && "an-rich-md-wrapper--unstyled",
        wrapperClassName,
        className,
      )}
      onClick={handleWrapperClick}
      data-plan-interactive={interactive ? true : undefined}
    >
      {editable ? (
        <BubbleToolbar editor={editor} buildItems={buildBubbleItems} />
      ) : null}
      {editable ? (
        <SlashCommandMenu editor={editor} items={effectiveSlashItems} />
      ) : null}
      <EditorContent editor={editor} className="an-rich-md-content" />
    </div>
  );
}
