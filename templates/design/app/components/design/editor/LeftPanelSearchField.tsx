import { IconSearch } from "@tabler/icons-react";
import { forwardRef } from "react";

import { Input } from "@/components/ui/input";

// The search row under a left-panel header. Layers and Tokens both open it from
// a header search button, so the field itself is shared.
export const LeftPanelSearchField = forwardRef<
  HTMLInputElement,
  {
    value: string;
    placeholder: string;
    onValueChange: (value: string) => void;
    onEscapeWhenEmpty: () => void;
  }
>(function LeftPanelSearchField(
  { value, placeholder, onValueChange, onEscapeWhenEmpty },
  ref,
) {
  return (
    <div className="shrink-0 p-1.5">
      <div className="relative">
        <IconSearch className="pointer-events-none absolute left-1.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={ref}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !value.trim()) onEscapeWhenEmpty();
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-6 rounded-[4px] border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] pl-6 text-[11px] shadow-none placeholder:text-muted-foreground/70 focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]"
        />
      </div>
    </div>
  );
});
