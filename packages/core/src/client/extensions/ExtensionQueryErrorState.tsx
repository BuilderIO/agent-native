import { IconRefresh } from "@tabler/icons-react";

import { useT } from "../i18n.js";
import { cn } from "../utils.js";

export function ExtensionQueryErrorState({
  message,
  onRetry,
  retrying = false,
  compact = false,
  className,
}: {
  message: string;
  onRetry: () => void;
  retrying?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const t = useT();

  return (
    <div
      role="alert"
      className={cn(
        "flex items-center text-destructive",
        compact
          ? "gap-2 px-2 py-1.5 text-[11px]"
          : "flex-col justify-center gap-3 px-4 py-8 text-center text-sm",
        className,
      )}
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className={cn(
          "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-border text-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-60",
          compact ? "px-2 py-1 text-[11px]" : "px-3 py-1.5 text-xs",
        )}
      >
        <IconRefresh className={cn("size-3.5", retrying && "animate-spin")} />
        {t("extensions.retry")}
      </button>
    </div>
  );
}
