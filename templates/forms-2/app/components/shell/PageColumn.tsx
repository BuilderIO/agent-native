import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function PageColumn({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[var(--forms-content-width)] px-4 min-[1200px]:px-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
