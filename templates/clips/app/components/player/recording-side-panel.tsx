import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "@/lib/utils";

export type RecordingSidePanelProps = Omit<
  ComponentPropsWithoutRef<"aside">,
  "children"
> & {
  children: ReactNode;
  tabs: ReactNode;
};

export function RecordingSidePanel({
  children,
  tabs,
  className,
  ...props
}: RecordingSidePanelProps) {
  return (
    <aside
      data-recording-side-panel
      className={cn(
        "mt-4 flex h-[min(420px,55dvh)] min-w-0 w-full shrink-0 flex-col overflow-hidden border-y border-border bg-background",
        "lg:my-4 lg:me-4 lg:h-auto lg:min-h-0 lg:w-auto lg:rounded-xl lg:border lg:bg-background lg:shadow-sm",
        className,
      )}
      {...props}
    >
      <div className="shrink-0">{tabs}</div>
      {children}
    </aside>
  );
}
