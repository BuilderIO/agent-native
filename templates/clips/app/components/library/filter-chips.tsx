import { IconX } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

export interface FilterChip {
  key: string;
  label: string;
  active?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
}

interface FilterChipsProps {
  chips: FilterChip[];
  className?: string;
}

export function FilterChips({ chips, className }: FilterChipsProps) {
  if (chips.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={chip.onClick}
          className={cn(
            "inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-xs border",
            chip.active
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-background text-foreground border-border hover:bg-accent",
          )}
        >
          <span className="truncate max-w-[10rem]">{chip.label}</span>
          {chip.onRemove && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                chip.onRemove?.();
              }}
              className={cn(
                "rounded-full hover:opacity-80",
                chip.active ? "text-white/80" : "text-muted-foreground",
              )}
            >
              <IconX className="h-3 w-3" />
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
