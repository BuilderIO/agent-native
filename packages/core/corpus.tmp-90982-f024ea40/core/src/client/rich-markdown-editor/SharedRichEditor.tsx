import type { Extension, Node, Mark } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useMemo, useRef } from "react";
import type { Awareness } from "y-protocols/awareness";
import type { Doc as YDoc } from "yjs";

import { cn } from "../utils.js";
import { BubbleToolbar, type BubbleToolbarItem } from "./BubbleToolbar.js";
import {
  createSharedEditorExtensions,
  type RichMarkdownDialect,
  type RichMarkdownEditorPreset,
  type RichMarkdownCollabUser,
  type SharedEditorFeatures,
} from "./extensions.js";
import type { ImageUploadFn } from "./ImageExtension.js";
import { SlashCommandMenu, type SlashCommandItem } from "./SlashCommandMenu.js";
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
  /** Toggle individual base extensions (tables/tasks/link/codeBlock/image). */
  features?: SharedEditorFeatures;
  /**
   * Injectable image uploader for the shared image block. Used only when
   * `features.image` is on. Pass `uploadEditorImage` (the framework
   * `upload-image` action) for a real uploading image block.
   */
  onImageUpload?: ImageUploadFn | null;
  /**
   * App-specific extensions (Notion nodes, media, drag handles, comment
   * anchors, …) appended after the shared base schema.
   */
  extraExtensions?: Array<Extension | Node | Mark>;
  placeholder?: string;
  className?: string;
  editorClassName?: string;
  ariaLabel?: string;
  interactive?: boolean;
  /**
   * Yjs document for real-time multi-user editing. When provided, prose is
   * authored against the shared Y.Doc and mirrored back to `value` as markdown
   * (still the source of truth). When omitted, the editor is a plain controlled
   * `value`/`onChange` editor — the existing, non-collaborative behavior.
   */
  ydoc?: YDoc | null;
  /** True after the collab provider has loaded persisted Y.Doc state. */
  collabSynced?: boolean;
  /** Shared awareness instance for live cursors/presence. */
  awareness?: Awareness | null;
  /** Current user info for the collaborative cursor label. */
  user?: RichMarkdownCollabUser | null;
  /**
   * Disable StarterKit's built-in undo/redo for a controlled (non-collab)
   * editor whose host owns its own undo authority (see
   * {@link CreateSharedEditorExtensionsOptions.disableHistory}). Ignored when a
   * `ydoc` is present (Yjs always owns history then). Default `false`, so every
   * existing embedder is unchanged.
   */
  disableHistory?: boolean;
  /** Override the slash-menu block command list. */
  slashItems?: SlashCommandItem[];
  /** Override the bubble-toolbar item builder. */
  buildBubbleItems?: (
    editor: import("@tiptap/react").Editor,
    toggleLink: () => void,
  ) => BubbleToolbarItem[];
  /**
   * Override how the editor's content is read into the canonical `value`.
   * Defaults to the tiptap-markdown storage reader. Apps with a custom on-disk
   * format (Content's NFM, the plan's `blocks[]` JSON) pass their serializer so
   * seed/reconcile/onChange all speak the same value space.
   */
  getMarkdown?: (editor: import("@tiptap/react").Editor) => string;
  /** Override how the canonical `value` is applied into the editor (seed + reconcile). */
  setContent?: (
    editor: import("@tiptap/react").Editor,
    value: string,
    options: { emitUpdate?: boolean; addToHistory?: boolean },
  ) => void;
  /**
   * Optional parser for surgical reconcile. Custom value formats that already
   * handle surgical writes inside `setContent` can pass `false` so the default
   * markdown parser never treats their source bytes as literal markdown.
   */
  parseValue?: UseCollabReconcileOptions["parseValue"];
  /** Canonicalize `value` for the echo / already-in-sync equality checks. */
  normalizeValue?: (value: string) => string;
  /** Override the empty-doc seed predicate (see {@link useCollabReconcile}). */
  shouldSeed?: (info: {
    value: string;
    currentMarkdown: string;
    fragmentLength: number;
  }) => boolean;
  /** Initial "applied" watermark (see {@link useCollabReconcile}). */
  initialAppliedUpdatedAt?: string | null;
  /** Extra class on the editor wrapper (e.g. a drag-handle `wrapperSelector` hook). */
  wrapperClassName?: string;
  /**
   * Fires once the editor instance exists. Lets a host capture the root
   * `editor.view` — e.g. to repaint the WHOLE document after a structural block
   * move (a column emptied and its container dissolved) that a surgical
   * per-region patch can't express, since the change is in the root doc itself.
   */
  onEditorReady?: (editor: import("@tiptap/react").Editor) => void;
}

/**
 * The single shared rich markdown editor surface. Combines
 * {@link createSharedEditorExtensions} (schema + dialect-keyed markdown +
 * optional collab + app extras), {@link useCollabReconcile} (seed / reconcile /
 * lead-client logic), and the shared {@link SlashCommandMenu} +
 * {@link BubbleToolbar}.
 *
 * With no `ydoc` it is a controlled `value`/`onChange` single-user editor.
 * With a `ydoc` it binds the framework collaboration stack; markdown stays the
 * canonical saved representation while the Y.Doc is transient live state.
 */
export function SharedRichEditor({
  value,
  onChange,
  onBlur,
  contentUpdatedAt,
  editable = true,
  dialect = "gfm",
  preset = "plan",
  features,
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
}: SharedRichEditorProps) {
  const readMarkdown = getMarkdown ?? getEditorMarkdown;
  const onChangeRef = useRef(onChange);
  const onBlurRef = useRef(onBlur);
  onChangeRef.current = onChange;
  onBlurRef.current = onBlur;

  const extensions = useMemo(
    () =>
      createSharedEditorExtensions({
        dialect,
        preset,
        placeholder,
        features,
        extraExtensions,
        onImageUpload,
        collab: ydoc ? { ydoc, awareness, user } : null,
        disableHistory,
      }),
    // `preset` is retained in the dependency list so future preset-specific
    // schema branches re-create the editor; it is currently schema-neutral. The
    // collab inputs are identity-stable per block (one Y.Doc per docId), so they
    // only change on a genuine doc switch — exactly when the editor must
    // re-create to rebind Collaboration.
    [
      dialect,
      placeholder,
      preset,
      features,
      extraExtensions,
      onImageUpload,
      ydoc,
      awareness,
      user?.name,
      user?.email,
      user?.color,
      disableHistory,
    ],
  );

  const collab = !!ydoc;

  // The collab hook needs the editor, but useEditor's `onUpdate` needs the
  // hook's guards. Break the cycle with a ref: `onUpdate` reads the guards
  // through `guardsRef`, which is populated right after the hook runs below.
  // `onUpdate` only ever fires after the editor exists, by which point the ref
  // holds the real guards.
  const guardsRef = useRef<UseCollabReconcileResult | null>(null);

  const editor = useEditor(
    {
      extensions,
      // With Collaboration active the prose is owned by the shared Y.XmlFragment.
      // Seeding `content` here too would make the editor initialize from BOTH the
      // prop and the Y.Doc, firing a spurious initial update that could autosave a
      // stale value over newer SQL. The lead-client seed effect populates an empty
      // doc instead. Non-collab editors keep initializing from `value`.
      // With Collaboration the Y.Doc owns the prose (seeded by the lead client).
      // With a custom `setContent` the reconcile seeds the editor too (the raw
      // `value` is not directly settable content — e.g. the plan's blocks JSON),
      // so only the plain markdown path seeds from `value` here.
      content: collab || setContent ? null : value,
      editable,
      editorProps: {
        attributes: {
          class: cn("an-rich-md-prose", editorClassName),
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
        className={cn("an-rich-md-wrapper an-rich-md-loading", className)}
        data-plan-interactive={interactive ? true : undefined}
      />
    );
  }

  return (
    <div
      className={cn(
        "an-rich-md-wrapper an-rich-md-clickable",
        !editable && "an-rich-md-wrapper--readonly",
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
        <SlashCommandMenu editor={editor} items={slashItems} />
      ) : null}
      <EditorContent editor={editor} />
    </div>
  );
}
