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
  placeholder = "Add a task...",
  buttonLabel = "Add task",
  inputAriaLabel = "New task title",
  errorMessage = "Failed to create task. Please try again.",
}: AddListItemInputProps) {
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
        toast.error(errorMessage);
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
        placeholder={placeholder}
        aria-label={inputAriaLabel}
        disabled={disabled}
      />
      <Button type="submit" disabled={disabled || !title.trim()}>
        {buttonLabel}
      </Button>
    </form>
  );
}
