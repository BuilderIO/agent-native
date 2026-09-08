import * as React from "react";

import { cn } from "@/lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  autoGrow?: boolean;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    { className, autoGrow = false, onInput, value, defaultValue, ...props },
    ref,
  ) => {
    const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

    const syncHeight = React.useCallback(
      (textarea: HTMLTextAreaElement | null = textareaRef.current) => {
        if (!autoGrow || !textarea) return;

        textarea.style.height = "auto";

        const computedMaxHeight = Number.parseFloat(
          window.getComputedStyle(textarea).maxHeight,
        );
        const hasMaxHeight = Number.isFinite(computedMaxHeight);
        const nextHeight = hasMaxHeight
          ? Math.min(textarea.scrollHeight, computedMaxHeight)
          : textarea.scrollHeight;

        textarea.style.height = `${nextHeight}px`;
        textarea.style.overflowY =
          hasMaxHeight && textarea.scrollHeight > computedMaxHeight
            ? "auto"
            : "hidden";
      },
      [autoGrow],
    );

    React.useEffect(() => {
      syncHeight();
    }, [syncHeight, value, defaultValue]);

    const setRef = React.useCallback(
      (node: HTMLTextAreaElement | null) => {
        textareaRef.current = node;
        if (typeof ref === "function") {
          ref(node);
        } else if (ref) {
          (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current =
            node;
        }
      },
      [ref],
    );

    return (
      <textarea
        className={cn(
          "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          autoGrow && "resize-none overflow-hidden",
          className,
        )}
        ref={setRef}
        value={value}
        defaultValue={defaultValue}
        onInput={(event) => {
          onInput?.(event);
          syncHeight(event.currentTarget);
        }}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
