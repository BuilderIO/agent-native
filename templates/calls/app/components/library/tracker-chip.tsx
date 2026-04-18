import { MouseEvent } from "react";
import { cn } from "@/lib/utils";

export interface TrackerChipProps {
  name: string;
  color?: string;
  count?: number;
  active?: boolean;
  size?: "sm" | "md";
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
}

export function TrackerChip({
  name,
  color = "hsl(var(--foreground))",
  count,
  active,
  size = "sm",
  onClick,
  className,
}: TrackerChipProps) {
  const Comp = onClick ? "button" : "span";
  return (
    <Comp
      onClick={onClick as any}
      type={onClick ? "button" : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border text-xs leading-none",
        size === "sm" ? "h-6 px-2" : "h-7 px-2.5",
        active
          ? "bg-foreground text-background border-foreground"
          : "bg-background text-foreground border-border",
        onClick && !active && "hover:bg-accent",
        onClick && "cursor-pointer",
        className,
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full shrink-0",
          active && "ring-1 ring-background/60",
        )}
        style={{ background: color }}
      />
      <span className="truncate max-w-[10rem]">{name}</span>
      {typeof count === "number" && count > 0 && (
        <span
          className={cn(
            "tabular-nums text-[10px] rounded-full px-1 min-w-[1rem] text-center",
            active
              ? "bg-background/20 text-background"
              : "bg-muted text-muted-foreground",
          )}
        >
          {count}
        </span>
      )}
    </Comp>
  );
}
