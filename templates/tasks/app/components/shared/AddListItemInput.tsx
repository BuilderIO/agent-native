import { useT } from "@agent-native/core/client/i18n";
import { useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface AddListItemInputProps {
  disabled?: boolean;
  onCreate: (title: string) => Promise<unknown>;
  placeholder?: string;
  buttonLabel?: string;
  inputAriaLabel?: string;
  errorMessage?: string;
}

export function AddListItemInput({
  disabled = false,
  onCreate,
  placeholder,
  buttonLabel,
  inputAriaLabel,
  errorMessage,
}: AddListItemInputProps) {
  const t = useT();
  const resolvedPlaceholder = placeholder ?? t("tasks.addPlaceholder");
  const resolvedButtonLabel = buttonLabel ?? t("tasks.addButtonLabel");
  const resolvedInputAriaLabel = inputAriaLabel ?? t("tasks.addInputAriaLabel");
  const resolvedErrorMessage = errorMessage ?? t("tasks.addErrorMessage");
  const [title, setTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    setTitle("");
    void onCreate(trimmed)
      .catch(() => {
        setTitle(trimmed);
        toast.error(resolvedErrorMessage);
      })
      .finally(() => {
        inputRef.current?.focus();
      });
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 p-1">
      <Input
        ref={inputRef}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder={resolvedPlaceholder}
        aria-label={resolvedInputAriaLabel}
        disabled={disabled}
      />
      <Button type="submit" disabled={disabled || !title.trim()}>
        {resolvedButtonLabel}
      </Button>
    </form>
  );
}
