import type { ReactNode } from "react";

interface CategoryProps {
  children: ReactNode;
}

export function Category({ children }: CategoryProps) {
  return (
    <span className="inline-flex items-center rounded-[var(--b-radius-full)] border border-solid border-[var(--b-border-default)] bg-[var(--b-bg-prominent)] px-[10px] py-[3px] font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-label-2)] font-semibold uppercase tracking-[0.04em] text-[var(--b-text-secondary)]">
      {children}
    </span>
  );
}
