import type { ReactNode } from "react";

interface IconBoxProps {
  children: ReactNode;
}

export function IconBox({ children }: IconBoxProps) {
  return (
    <div className="inline-flex h-10 w-10 items-center justify-center rounded-[var(--b-radius)] border border-solid border-[var(--b-border-default)] bg-[var(--b-bg-prominent)] text-[var(--b-text-eyebrow)]">
      {children}
    </div>
  );
}
