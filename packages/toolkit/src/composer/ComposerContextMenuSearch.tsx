import { useEffect, useRef, type ReactNode } from "react";

import { MenuSearchInput } from "../ui/command.js";

/** Integrated search with keyboard navigation owned by its Radix menu. */
export function ComposerContextMenuSearch({
  placeholder,
  value,
  onValueChange,
  leading,
  invalid,
  onSubmit,
}: {
  placeholder: string;
  value: string;
  onValueChange: (value: string) => void;
  leading?: ReactNode;
  invalid?: boolean;
  onSubmit?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const menu = input.current?.closest('[role="menu"]');
      // Ancestors can mount in the same frame when a source is resumed.
      if (!menu?.querySelector('[aria-haspopup="menu"][aria-expanded="true"]'))
        input.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [placeholder]);
  return (
    <MenuSearchInput
      ref={input}
      placeholder={placeholder}
      aria-label={placeholder}
      aria-invalid={invalid}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      leading={leading}
      onKeyDown={(event) => {
        const menu = input.current?.closest('[role="menu"]');
        const rows = Array.from(
          menu?.querySelectorAll<HTMLElement>(
            '[role^="menuitem"]:not([data-disabled])',
          ) ?? [],
        ).filter((row) => row.closest('[role="menu"]') === menu);
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          event.stopPropagation();
          (event.key === "ArrowDown" ? rows[0] : rows.at(-1))?.focus();
        } else if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          if (onSubmit) onSubmit();
          else rows[0]?.click();
        } else if (
          event.key.length === 1 ||
          event.key === "ArrowLeft" ||
          event.key === "ArrowRight" ||
          event.key === "Home" ||
          event.key === "End"
        ) {
          // Text entry must not activate Radix's menu typeahead.
          event.stopPropagation();
        }
      }}
    />
  );
}
