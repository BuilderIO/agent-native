import { useEffect, useRef, useState } from "react";

import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export function descriptionFieldSavedValue(
  draft: string,
  savedDescription: string | null | undefined,
) {
  const next = draft.trim();
  return next === (savedDescription ?? "") ? null : next;
}

export function descriptionFieldEscapeDraft(
  savedDescription: string | null | undefined,
) {
  return savedDescription ?? "";
}

/**
 * Quiet, stable guidance attached to a page or database. This intentionally
 * renders the owned description only; ancestor context is assembled for agent
 * reads rather than copied into the surface.
 */
export function DescriptionField({
  description,
  canEdit,
  label = "Description",
  placeholder = "Add a description…",
  className,
  onSave,
}: {
  description: string | null | undefined;
  canEdit: boolean;
  label?: string;
  placeholder?: string;
  className?: string;
  onSave: (description: string) => Promise<unknown> | unknown;
}) {
  const [draft, setDraft] = useState(description ?? "");
  const [editing, setEditing] = useState(false);
  const skipNextBlurSaveRef = useRef(false);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const saveRevisionRef = useRef(0);
  const confirmedDescriptionRef = useRef(description ?? "");

  useEffect(() => {
    confirmedDescriptionRef.current = description ?? "";
  }, [description]);

  useEffect(() => {
    if (!editing) setDraft(description ?? "");
  }, [description, editing]);

  const save = async () => {
    const next = descriptionFieldSavedValue(draft, description);
    if (next === null) return;

    const revision = ++saveRevisionRef.current;
    const request = saveQueueRef.current.then(() => onSave(next));
    saveQueueRef.current = request.then(
      () => undefined,
      () => undefined,
    );

    try {
      await request;
      confirmedDescriptionRef.current = next;
    } catch {
      if (saveRevisionRef.current === revision) {
        setDraft(confirmedDescriptionRef.current);
      }
    }
  };

  if (!canEdit && !description) return null;

  if (!canEdit) {
    return (
      <p
        className={cn(
          "mt-2 text-sm leading-6 text-muted-foreground",
          className,
        )}
      >
        {description}
      </p>
    );
  }

  return (
    <Textarea
      aria-label={label}
      rows={1}
      wrap="soft"
      value={draft}
      placeholder={placeholder}
      onFocus={() => setEditing(true)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        setEditing(false);
        if (skipNextBlurSaveRef.current) {
          skipNextBlurSaveRef.current = false;
          return;
        }
        void save();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          event.preventDefault();
          event.currentTarget.blur();
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          skipNextBlurSaveRef.current = true;
          setDraft(descriptionFieldEscapeDraft(description));
          event.currentTarget.blur();
        }
      }}
      style={{ fieldSizing: "content" } as any}
      className={cn(
        "mt-2 min-h-6 w-full resize-none overflow-hidden rounded-none border-0 bg-transparent px-0 py-0 text-sm leading-6 text-muted-foreground shadow-none outline-none placeholder:text-muted-foreground/45 focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0",
        className,
      )}
    />
  );
}
