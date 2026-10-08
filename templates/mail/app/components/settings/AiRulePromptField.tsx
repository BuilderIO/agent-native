import type { FocusEventHandler, KeyboardEventHandler } from "react";

import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export function AiRulePromptField({
  value,
  onChange,
  label,
  placeholder,
  className,
  disabled,
  onKeyDown,
  onBlur,
  defaultValue,
}: {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  label: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>;
  onBlur?: FocusEventHandler<HTMLTextAreaElement>;
}) {
  return (
    <Textarea
      value={value}
      defaultValue={defaultValue}
      onChange={(event) => onChange?.(event.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      aria-label={label}
      className={cn(
        "placeholder:text-muted-foreground",
        className ?? "min-h-28 resize-none text-sm",
      )}
      maxLength={2_000}
    />
  );
}
