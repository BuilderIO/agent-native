import { useCallback, useEffect, useRef } from "react";
import { RichMarkdownEditor } from "@agent-native/core/client";
import { cn } from "@/lib/utils";

const SAVE_DEBOUNCE_MS = 700;
const SAVE_RETRY_MS = 120;

type PlanMarkdownEditorProps = {
  markdown: string;
  onSave: (markdown: string) => Promise<void> | void;
  editable?: boolean;
  className?: string;
  contentUpdatedAt?: string | null;
};

export function PlanMarkdownEditor({
  markdown,
  onSave,
  editable = true,
  className,
  contentUpdatedAt,
}: PlanMarkdownEditorProps) {
  const onSaveRef = useRef(onSave);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPersistedMarkdownRef = useRef(markdown);
  const latestMarkdownRef = useRef(markdown);
  const savingRef = useRef(false);
  const flushRequestedRef = useRef(false);
  const flushSaveRef = useRef<() => Promise<void>>(async () => {});

  onSaveRef.current = onSave;

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
      className={cn("plan-rich-markdown-editor mt-4", className)}
      interactive={editable}
    />
  );
}
