import type { ReactNode } from "react";

interface CodeTagProps {
  children: ReactNode;
}

export function CodeTag({ children }: CodeTagProps) {
  return (
    <code className="rounded-[var(--b-radius-sm)] border border-solid border-[var(--b-border-default)] bg-[var(--b-bg-raised)] px-[5px] py-px font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-paragraph-3)] text-[var(--c-green-400)]">
      {children}
    </code>
  );
}
