import * as React from "react";

import { SqlHighlight } from "@/components/SqlHighlight";
import { cn } from "@/lib/utils";

export interface SqlEditorProps extends Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value"
> {
  value: string;
}

export const SqlEditor = React.forwardRef<HTMLTextAreaElement, SqlEditorProps>(
  ({ className, onScroll, value, disabled, readOnly, ...props }, ref) => {
    const highlightRef = React.useRef<HTMLPreElement | null>(null);

    const handleScroll = (event: React.UIEvent<HTMLTextAreaElement>) => {
      const highlight = highlightRef.current;
      if (highlight) {
        highlight.scrollTop = event.currentTarget.scrollTop;
        highlight.scrollLeft = event.currentTarget.scrollLeft;
      }
      onScroll?.(event);
    };

    return (
      <div
        className={cn(
          "relative min-h-[200px] rounded-md border border-input bg-background ring-offset-background focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
          disabled && "cursor-not-allowed opacity-50",
          className,
        )}
      >
        <SqlHighlight
          ref={highlightRef}
          aria-hidden="true"
          sql={value || " "}
          preClassName="pointer-events-none absolute inset-0 overflow-hidden rounded-md bg-transparent p-3 text-xs leading-5"
          className="text-foreground"
        />
        <textarea
          ref={ref}
          value={value}
          disabled={disabled}
          readOnly={readOnly}
          onScroll={handleScroll}
          spellCheck={false}
          className={cn(
            "relative z-10 min-h-[inherit] w-full resize-y rounded-md border-0 bg-transparent p-3 font-mono text-xs leading-5 text-transparent caret-foreground outline-none selection:bg-primary/30 placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed",
            readOnly && "cursor-default",
          )}
          {...props}
        />
      </div>
    );
  },
);
SqlEditor.displayName = "SqlEditor";
