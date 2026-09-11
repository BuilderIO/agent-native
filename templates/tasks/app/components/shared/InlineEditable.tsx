import {
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
} from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const LIST_ROW_TITLE_FIELD_CLASS =
  "h-8 w-full rounded-md border px-3 text-sm leading-8";

function useInlineTitleEdit(input: {
  title: string;
  onSave: (title: string) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(input.title);
  const [optimisticTitle, setOptimisticTitle] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const skipBlurSaveRef = useRef(false);

  const displayTitle = optimisticTitle ?? input.title;

  useEffect(() => {
    if (optimisticTitle !== null && input.title === optimisticTitle) {
      setOptimisticTitle(null);
    }
    if (!editing && optimisticTitle === null) {
      setDraftTitle(input.title);
    }
  }, [editing, optimisticTitle, input.title]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  async function saveTitle() {
    const trimmed = draftTitle.trim();
    if (!trimmed || trimmed === input.title) {
      setDraftTitle(input.title);
      setOptimisticTitle(null);
      setEditing(false);
      return;
    }
    setOptimisticTitle(trimmed);
    setEditing(false);
    try {
      await input.onSave(trimmed);
    } catch {
      setOptimisticTitle(null);
      setDraftTitle(input.title);
    }
  }

  function handleTitleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      skipBlurSaveRef.current = true;
      void saveTitle();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      skipBlurSaveRef.current = true;
      setDraftTitle(displayTitle);
      setEditing(false);
    }
  }

  function handleTitleBlur() {
    if (skipBlurSaveRef.current) {
      skipBlurSaveRef.current = false;
      return;
    }
    void saveTitle();
  }

  return {
    editing,
    setEditing,
    draftTitle,
    setDraftTitle,
    displayTitle,
    inputRef,
    handleTitleKeyDown,
    handleTitleBlur,
  };
}

interface InlineEditableProps {
  value: string;
  onSave: (title: string) => Promise<unknown>;
  ariaLabel: string;
  disabled?: boolean;
  titleDragProps?: HTMLAttributes<HTMLButtonElement>;
  displayDone?: boolean;
  className?: string;
  onDisplayTitleChange?: (title: string) => void;
}

export function InlineEditable({
  value,
  onSave,
  ariaLabel,
  disabled = false,
  titleDragProps,
  displayDone = false,
  className,
  onDisplayTitleChange,
}: InlineEditableProps) {
  const {
    editing,
    setEditing,
    draftTitle,
    setDraftTitle,
    displayTitle,
    inputRef,
    handleTitleKeyDown,
    handleTitleBlur,
  } = useInlineTitleEdit({ title: value, onSave });

  useEffect(() => {
    onDisplayTitleChange?.(displayTitle);
  }, [displayTitle, onDisplayTitleChange]);

  if (editing) {
    return (
      <Input
        ref={inputRef}
        value={draftTitle}
        onChange={(event) => setDraftTitle(event.target.value)}
        onBlur={handleTitleBlur}
        onKeyDown={handleTitleKeyDown}
        aria-label={ariaLabel}
        className={cn(
          LIST_ROW_TITLE_FIELD_CLASS,
          "border-input bg-background py-0 shadow-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0",
          className,
        )}
        disabled={disabled}
      />
    );
  }

  return (
    <button
      type="button"
      {...titleDragProps}
      onClick={() => setEditing(true)}
      disabled={disabled}
      className={cn(
        LIST_ROW_TITLE_FIELD_CLASS,
        "flex cursor-text items-center truncate border-transparent bg-transparent text-left outline-none transition-[color,text-decoration-color] duration-200 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:cursor-not-allowed",
        displayDone && "line-through text-muted-foreground",
        className,
      )}
    >
      {displayTitle}
    </button>
  );
}
