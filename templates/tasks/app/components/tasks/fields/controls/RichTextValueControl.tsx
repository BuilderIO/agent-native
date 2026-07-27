import { useT } from "@agent-native/core/client/i18n";
import {
  IconBold,
  IconH1,
  IconItalic,
  IconLink,
  IconList,
  IconListNumbers,
} from "@tabler/icons-react";
import { useRef } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function RichTextValueControl({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  function applyWrap(before: string, after = before, placeholder = "text") {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.slice(start, end) || placeholder;
    const next = `${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`;
    onChange(next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(
        start + before.length,
        start + before.length + selected.length,
      );
    });
  }

  function applyLinePrefix(prefix: string) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const next = `${value.slice(0, lineStart)}${prefix}${value.slice(lineStart)}`;
    onChange(next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, start + prefix.length);
    });
  }

  const tools = [
    {
      label: t("taskFields.toolBold"),
      icon: IconBold,
      action: () => applyWrap("**", "**", "bold"),
    },
    {
      label: t("taskFields.toolItalic"),
      icon: IconItalic,
      action: () => applyWrap("_", "_", "italic"),
    },
    {
      label: t("taskFields.toolHeading"),
      icon: IconH1,
      action: () => applyLinePrefix("## "),
    },
    {
      label: t("taskFields.toolBulletedList"),
      icon: IconList,
      action: () => applyLinePrefix("- "),
    },
    {
      label: t("taskFields.toolNumberedList"),
      icon: IconListNumbers,
      action: () => applyLinePrefix("1. "),
    },
    {
      label: t("taskFields.toolLink"),
      icon: IconLink,
      action: () => applyWrap("[", "](https://example.com)", "link"),
    },
  ];

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-1">
        {tools.map((tool) => {
          const Icon = tool.icon;
          return (
            <Button
              key={tool.label}
              type="button"
              variant="ghost"
              size="icon"
              disabled={disabled}
              onClick={tool.action}
              aria-label={tool.label}
              title={tool.label}
              className="size-8"
            >
              <Icon className="size-4" />
            </Button>
          );
        })}
      </div>
      <Textarea
        ref={textareaRef}
        value={value}
        disabled={disabled}
        rows={5}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </div>
  );
}
