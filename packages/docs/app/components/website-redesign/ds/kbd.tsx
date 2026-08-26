import type { ReactNode } from "react";

interface KbdProps {
  children: ReactNode;
}

export function Kbd({ children }: KbdProps) {
  return (
    <kbd className="rounded-[var(--b-radius-sm)] border border-solid border-[var(--b-border-default)] bg-[var(--b-bg-prominent)] px-[6px] py-[2px] font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-label-2)] text-[var(--b-text-secondary)]">
      {children}
    </kbd>
  );
}
