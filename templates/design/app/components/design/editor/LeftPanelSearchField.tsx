import { IconSearch, IconX } from "@tabler/icons-react";
import { forwardRef } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// The search row under a left-panel header. Layers and Tokens both open it from
// a header search button, so the field itself is shared.
export const LeftPanelSearchField = forwardRef<
  HTMLInputElement,
  {
    value: string;
    placeholder: string;
    /** Names the clear button; without it the field has none. */
    clearLabel?: string;
    onValueChange: (value: string) => void;
    onEscapeWhenEmpty: () => void;
  }
>(function LeftPanelSearchField(
  { value, placeholder, clearLabel, onValueChange, onEscapeWhenEmpty },
  ref,
) {
  const hasValue = Boolean(value);
  return (
    <div className="shrink-0 p-1.5">
      <div className="relative">
        <IconSearch className="pointer-events-none absolute left-1.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={ref}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            if (hasValue) onValueChange("");
            else onEscapeWhenEmpty();
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          className={cn(
            "h-6 rounded-[4px] border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] pl-6 text-[11px] shadow-none placeholder:text-muted-foreground/70 focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]",
            clearLabel && hasValue && "pr-6",
          )}
        />
        {clearLabel && hasValue ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={clearLabel}
            title={clearLabel}
            className="absolute right-1 top-1/2 size-4 -translate-y-1/2 rounded-sm p-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
            onClick={() => {
              onValueChange("");
              onEscapeWhenEmpty();
            }}
          >
            <IconX className="!size-3" />
          </Button>
        ) : null}
      </div>
    </div>
  );
});
