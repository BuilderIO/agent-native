import type { ReactNode } from "react";

interface KbdProps {
  children: ReactNode;
}

export function Kbd({ children }: KbdProps) {
  return (
    <kbd
      style={{
        fontFamily: "var(--b-font-mono)",
        fontSize: "var(--b-t-label-2)",
        color: "var(--b-text-secondary)",
        background: "var(--b-bg-prominent)",
        border: "1px solid var(--b-border-default)",
        borderRadius: "var(--b-radius-sm)",
        padding: "2px 6px",
      }}
    >
      {children}
    </kbd>
  );
}
