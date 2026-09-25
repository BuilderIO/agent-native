import type { FocusEventHandler, KeyboardEventHandler } from "react";

import { Textarea } from "@/components/ui/textarea";

export function AiRulePromptField({
  value,
  onChange,
  label,
  placeholder,
  className,
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
  onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>;
  onBlur?: FocusEventHandler<HTMLTextAreaElement>;
}) {
  return (
    <Textarea
      value={value}
      defaultValue={defaultValue}
      onChange={(event) => onChange?.(event.target.value)}
      placeholder={placeholder}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      aria-label={label}
      className={className ?? "min-h-28 resize-none text-sm"}
      maxLength={2_000}
    />
  );
}
