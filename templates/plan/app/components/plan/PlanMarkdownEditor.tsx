import { generateTabId } from "@agent-native/core/client/agent-chat";
import {
  useCollaborativeDoc,
  type CollabUser,
} from "@agent-native/core/client/collab";
import {
  createImageSlashCommand,
  DEFAULT_SLASH_COMMANDS,
  RichMarkdownEditor,
  type RichMarkdownCollabUser,
} from "@agent-native/toolkit/editor";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { cn } from "@/lib/utils";

import { usePlanImageUpload } from "../../hooks/use-plan-image-upload";
import { PlanImageNode } from "./PlanImageNode";

const PLAN_EDITOR_FEATURES = { image: false } as const;
const SAVE_DEBOUNCE_MS = 700;
const SAVE_RETRY_MS = 120;

const TAB_ID = generateTabId();

type PlanMarkdownEditorProps = {
  markdown: string;
  onSave: (markdown: string) => Promise<void> | void;
  editable?: boolean;
  className?: string;
  ariaLabel?: string;
  contentUpdatedAt?: string | null;
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
  const { requestUpload, uploadImage, storagePrompt } = usePlanImageUpload();
  const onSaveRef = useRef(onSave);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPersistedMarkdownRef = useRef(markdown);
  const latestMarkdownRef = useRef(markdown);
  const savingRef = useRef(false);
  const flushRequestedRef = useRef(false);
  const flushSaveRef = useRef<() => Promise<void>>(async () => {});

  onSaveRef.current = onSave;

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
    initialization,
    requestSync,
  } = useCollaborativeDoc({
    docId,
    activityResource: planId
      ? { resourceType: "plan", resourceId: planId }
      : undefined,
    requestSource: TAB_ID,
    user: collabUser ?? undefined,
  });
  const editorEditable =
    editable && (!collabEnabled || initialization.status === "ready");
  const slashCommands = useMemo(() => {
    const imageCommand = createImageSlashCommand(uploadImage);
    return [
      ...DEFAULT_SLASH_COMMANDS,
      ...(editable
        ? [
            {
              ...imageCommand,
              action: (editor) => {
                if (requestUpload()) imageCommand.action(editor);
              },
            },
          ]
        : []),
    ];
  }, [editable, requestUpload, uploadImage]);
  const extraExtensions = useMemo(
    () => [
      PlanImageNode.configure({
        onImageUpload: editable ? uploadImage : null,
      }),
    ],
    [editable, uploadImage],
  );

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
      if (!editorEditable) return;
      queueFlush();
    },
    [editorEditable, queueFlush],
  );

  return (
    <div>
      <RichMarkdownEditor
        value={markdown}
        onChange={handleChange}
        onBlur={() => void flushSave()}
        editable={editorEditable}
        contentUpdatedAt={contentUpdatedAt}
        dialect="gfm"
        preset="plan"
        features={PLAN_EDITOR_FEATURES}
        extraExtensions={extraExtensions}
        onImageUpload={editable ? uploadImage : null}
        slashItems={slashCommands}
        className={cn("plan-rich-markdown-editor mt-4", className)}
        ariaLabel={ariaLabel}
        interactive={editorEditable}
        ydoc={collabEnabled ? ydoc : null}
        collabSynced={collabEnabled ? collabSynced : true}
        requestCollabSync={collabEnabled ? requestSync : undefined}
        awareness={collabEnabled ? awareness : null}
        user={collabEnabled ? collabUser : null}
      />
      {storagePrompt}
    </div>
  );
}
