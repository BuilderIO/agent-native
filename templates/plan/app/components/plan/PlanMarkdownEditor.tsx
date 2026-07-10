import {
  RichMarkdownEditor,
  useCollaborativeDoc,
  generateTabId,
  uploadEditorImage,
  createImageSlashCommand,
  DEFAULT_SLASH_COMMANDS,
  type RichMarkdownCollabUser,
  type CollabUser,
} from "@agent-native/core/client";
import { useCallback, useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

import { PlanImageNode } from "./PlanImageNode";

// Plans get the shared block-level image node: the `/image` slash command, plus
// paste / drag-drop of image files. Each image uploads through the framework
// `upload-image` action (`uploadEditorImage`) and is inserted as a standard
// `![alt](url)` markdown image, so it autosaves through the existing
// `update-rich-text` path and stays source-syncable.
const PLAN_SLASH_COMMANDS = [
  ...DEFAULT_SLASH_COMMANDS,
  createImageSlashCommand(uploadEditorImage),
];
// `features.image` is off because `PlanImageNode` (injected below) IS the image
// node — it extends the shared node with a React node view that adds the hover
// zoom / lightbox / three-dots menu. Enabling the core image node too would
// register a second `image` node and collide.
const PLAN_EDITOR_FEATURES = { image: false } as const;
const PLAN_EXTRA_EXTENSIONS = [PlanImageNode];

const SAVE_DEBOUNCE_MS = 700;
const SAVE_RETRY_MS = 120;

// Stable per-tab request source so this client ignores its own collab updates
// echoing back through the poll ring buffer.
const TAB_ID = generateTabId();

type PlanMarkdownEditorProps = {
  markdown: string;
  onSave: (markdown: string) => Promise<void> | void;
  editable?: boolean;
  className?: string;
  ariaLabel?: string;
  contentUpdatedAt?: string | null;
  /**
   * When both `planId` and `blockId` are present, prose for this block is edited
   * collaboratively against a shared Y.Doc keyed `plan:${planId}:${blockId}`.
   * Markdown still autosaves through `onSave` (the `update-rich-text` patch), so
   * the canonical content in `plans.content` is unchanged. When absent (public
   * read, SSR, or missing session) the editor falls back to today's controlled
   * single-user editing.
   */
  planId?: string | null;
  blockId?: string | null;
  user?: RichMarkdownCollabUser | null;
};

export function PlanMarkdownEditor({
  markdown,
  onSave,
  editable = true,
  className,
  ariaLabel,
  contentUpdatedAt,
  planId,
  blockId,
  user,
}: PlanMarkdownEditorProps) {
  const onSaveRef = useRef(onSave);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPersistedMarkdownRef = useRef(markdown);
  const latestMarkdownRef = useRef(markdown);
  const savingRef = useRef(false);
  const flushRequestedRef = useRef(false);
  const flushSaveRef = useRef<() => Promise<void>>(async () => {});

  onSaveRef.current = onSave;

  // Gate collab on an editable block with a real plan/block id and a known user
  // with an email (cursors need a stable label + identity). Anything missing
  // keeps the non-collab single-user path.
  const collabUser: CollabUser | null =
    user && user.email
      ? { name: user.name, email: user.email, color: user.color }
      : null;
  const collabEnabled = !!(editable && planId && blockId && collabUser);
  const docId = collabEnabled ? `plan:${planId}:${blockId}` : null;
  const {
    ydoc,
    awareness,
    isSynced: collabSynced,
  } = useCollaborativeDoc({
    docId,
    requestSource: TAB_ID,
    user: collabUser ?? undefined,
  });

  const queueFlush = useCallback((delay = SAVE_DEBOUNCE_MS) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void flushSaveRef.current();
    }, delay);
  }, []);

  const flushSave = useCallback(async () => {
    const nextMarkdown = latestMarkdownRef.current;
    if (nextMarkdown === lastPersistedMarkdownRef.current) return;

    if (savingRef.current) {
      flushRequestedRef.current = true;
      return;
    }

    savingRef.current = true;
    flushRequestedRef.current = false;
    try {
      await onSaveRef.current(nextMarkdown);
      lastPersistedMarkdownRef.current = nextMarkdown;
    } catch (error) {
      console.error("Failed to autosave plan markdown block:", error);
    } finally {
      savingRef.current = false;
      if (
        flushRequestedRef.current ||
        latestMarkdownRef.current !== lastPersistedMarkdownRef.current
      ) {
        queueFlush(SAVE_RETRY_MS);
      }
    }
  }, [queueFlush]);

  flushSaveRef.current = flushSave;

  useEffect(() => {
    const latest = latestMarkdownRef.current;
    const lastPersisted = lastPersistedMarkdownRef.current;
    if (latest === lastPersisted || latest === markdown) {
      latestMarkdownRef.current = markdown;
    }
    lastPersistedMarkdownRef.current = markdown;
  }, [markdown, contentUpdatedAt]);

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      void flushSave();
    },
    [flushSave],
  );

  const handleChange = useCallback(
    (nextMarkdown: string) => {
      latestMarkdownRef.current = nextMarkdown;
      if (!editable) return;
      queueFlush();
    },
    [editable, queueFlush],
  );

  return (
    <RichMarkdownEditor
      value={markdown}
      onChange={handleChange}
      onBlur={() => void flushSave()}
      editable={editable}
      contentUpdatedAt={contentUpdatedAt}
      dialect="gfm"
      preset="plan"
      features={PLAN_EDITOR_FEATURES}
      extraExtensions={PLAN_EXTRA_EXTENSIONS}
      onImageUpload={uploadEditorImage}
      slashItems={PLAN_SLASH_COMMANDS}
      className={cn("plan-rich-markdown-editor mt-4", className)}
      ariaLabel={ariaLabel}
      interactive={editable}
      ydoc={collabEnabled ? ydoc : null}
      collabSynced={collabEnabled ? collabSynced : true}
      awareness={collabEnabled ? awareness : null}
      user={collabEnabled ? collabUser : null}
    />
  );
}
