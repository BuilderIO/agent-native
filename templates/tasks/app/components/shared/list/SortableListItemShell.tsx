import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SortableListItemShellProps {
  setNodeRef: (element: HTMLElement | null) => void;
  style: React.CSSProperties | undefined;
  isDragging: boolean;
  hideForBlockDrag: boolean;
  children: ReactNode;
}

export function SortableListItemShell({
  setNodeRef,
  style,
  isDragging,
  hideForBlockDrag,
  children,
}: SortableListItemShellProps) {
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "transition-[height,opacity,margin] duration-200 ease-out",
        (isDragging || hideForBlockDrag) && "opacity-0",
      )}
    >
      {children}
    </div>
  );
}
