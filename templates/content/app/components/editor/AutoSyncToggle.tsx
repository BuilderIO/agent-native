import { IconRefresh } from "@tabler/icons-react";

import { cn } from "@/lib/utils";

export function AutoSyncToggle({
  label,
  checked,
  onCheckedChange,
  disabled,
  title,
  className,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      title={title}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
        className,
      )}
    >
      <IconRefresh
        size={12}
        aria-hidden
        className={checked ? "text-emerald-500" : "text-muted-foreground"}
      />
      <span
        className={
          checked ? "text-foreground font-medium" : "text-muted-foreground"
        }
      >
        {label}
      </span>
      <span
        aria-hidden
        className={cn(
          "ml-auto h-4 w-7 rounded-full relative",
          checked ? "bg-emerald-500" : "bg-muted-foreground/30",
        )}
      >
        <span
          className={cn(
            // guard:allow-raw-color — the knob stays white on both pill colors, as Notion's Auto-sync switch drew it before it moved here.
            "absolute top-0.5 h-3 w-3 rounded-full bg-white",
            checked ? "right-0.5" : "left-0.5",
          )}
        />
      </span>
    </button>
  );
}
