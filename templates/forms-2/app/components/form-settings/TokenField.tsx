import { useT } from "@agent-native/core/client/i18n";
import {
  mentionToken,
  resolveMentions,
  type MentionRef,
} from "@shared/form-model";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type TokenOption = { ref: MentionRef; label: string };

const TRIGGER = /(^|\s)@([^@\n]{0,40})$/;

/** Stored text holds `{{...}}` tokens; the field shows each as `@Label`. */
const toDisplay = (value: string, options: TokenOption[]) =>
  resolveMentions(value, (ref) => {
    const found = options.find(
      (option) => mentionToken(option.ref) === mentionToken(ref),
    );
    return found ? `@${found.label}` : mentionToken(ref);
  });

function toStored(text: string, options: TokenOption[]) {
  const longestFirst = [...options].sort(
    (a, b) => b.label.length - a.label.length,
  );
  return longestFirst.reduce(
    (stored, option) =>
      stored.split(`@${option.label}`).join(mentionToken(option.ref)),
    text,
  );
}

/** A plain input or textarea where typing `@` offers `options` and inserts a token. */
export function TokenField({
  label,
  value,
  options,
  onChange,
  multiline = false,
  placeholder,
  maxLength,
  invalid,
}: {
  label: string;
  value: string;
  options: TokenOption[];
  onChange: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
  maxLength?: number;
  invalid?: boolean;
}) {
  const t = useT();
  const text = toDisplay(value, options);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<string | null>(null);

  const match = TRIGGER.exec(text.slice(0, caret));
  const filter = (match?.[2] ?? "").trim().toLowerCase();
  const shown = match
    ? options.filter((option) => option.label.toLowerCase().includes(filter))
    : [];
  const open = shown.length > 0 && dismissedAt !== text;

  function pick(option: TokenOption) {
    if (!match) return;
    const start = caret - (match[2]?.length ?? 0) - 1;
    const next = `${text.slice(0, start)}@${option.label}${text.slice(caret)}`;
    setDismissedAt(next);
    onChange(toStored(next, options));
  }

  function edit(element: HTMLInputElement | HTMLTextAreaElement) {
    setCaret(element.selectionStart ?? element.value.length);
    setActive(0);
    onChange(toStored(element.value, options));
  }

  function onKeyDown(
    event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    if (!open) return;
    const chosen = shown[active];
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (index + step + shown.length) % shown.length);
    } else if ((event.key === "Enter" || event.key === "Tab") && chosen) {
      event.preventDefault();
      pick(chosen);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDismissedAt(text);
    }
  }

  const shared = {
    "aria-label": label,
    "aria-invalid": invalid ? true : undefined,
    placeholder,
    maxLength,
    value: text,
    onKeyDown,
    onSelect: (
      event: React.SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => setCaret(event.currentTarget.selectionStart ?? 0),
  };

  return (
    <div className="relative">
      {multiline ? (
        <Textarea
          {...shared}
          rows={5}
          onChange={(event) => edit(event.target)}
        />
      ) : (
        <Input {...shared} onChange={(event) => edit(event.target)} />
      )}
      {open ? (
        <div
          role="listbox"
          aria-label={t("forms.mentions.menuLabel")}
          className="absolute left-0 top-full z-50 mt-1 max-h-64 w-64 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-sm text-popover-foreground shadow-md"
          onMouseDown={(event) => event.preventDefault()}
        >
          {shown.map((option, index) => (
            <div
              key={mentionToken(option.ref)}
              role="option"
              aria-selected={index === active}
              className={cn(
                "cursor-pointer truncate rounded-md px-2 py-1.5",
                index === active && "bg-accent",
              )}
              onMouseEnter={() => setActive(index)}
              onClick={() => pick(option)}
            >
              {option.label}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
