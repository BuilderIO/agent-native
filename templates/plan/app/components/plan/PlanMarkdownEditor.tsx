import { generateTabId } from "@agent-native/core/client/agent-chat";
import {
  useCollaborativeDoc,
  type CollabUser,
} from "@agent-native/core/client/collab";
import { callAction } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  createImageSlashCommand,
  DEFAULT_SLASH_COMMANDS,
  RichMarkdownEditor,
  type RichMarkdownCollabUser,
} from "@agent-native/toolkit/editor";
import { createDocument, type Editor } from "@tiptap/core";
import { prosemirrorToYDoc } from "@tiptap/y-tiptap";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { encodeStateAsUpdate } from "yjs";

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

  // Two people opening a plan together would each seed this block's empty live
  // document from its saved markdown, and the two copies merge into duplicated
  // text. The server seeds it once and every editor adopts that copy.
  const requestInitialSeed = useCallback(
    async (seedEditor: Editor, markdown: string): Promise<Uint8Array> => {
      if (!planId || !blockId)
        throw new Error("A plan and block ID are required to seed the editor.");
      const parser = (
        seedEditor.storage as {
          markdown?: { parser?: { parse(content: string): string } };
        }
      ).markdown?.parser;
      if (!parser) throw new Error("The editor cannot read markdown.");
      const seedDoc = prosemirrorToYDoc(
        createDocument(parser.parse(markdown), seedEditor.schema),
        "default",
      );
      try {
        const update = encodeStateAsUpdate(seedDoc);
        let binary = "";
        for (const byte of update) binary += String.fromCharCode(byte);
        const result = await callAction<{ stateBase64: string }>(
          "seed-plan-collab",
          { planId, blockId, seedUpdateBase64: btoa(binary) },
        );
        return Uint8Array.from(atob(result.stateBase64), (char) =>
          char.charCodeAt(0),
        );
      } finally {
        seedDoc.destroy();
      }
    },
    [planId, blockId],
  );
  const t = useT();
  const seedErrorShownRef = useRef(false);
  const onInitialSeedError = useCallback(
    (error: unknown) => {
      console.error("Failed to open the plan block for live editing:", error);
      if (seedErrorShownRef.current) return;
      seedErrorShownRef.current = true;
      toast.error(t("raw.content.openFailed"));
    },
    [t],
  );
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
        requestInitialSeed={
          collabEnabled && editable ? requestInitialSeed : undefined
        }
        onInitialSeedError={onInitialSeedError}
        awareness={collabEnabled ? awareness : null}
        user={collabEnabled ? collabUser : null}
      />
      {storagePrompt}
    </div>
  );
}
