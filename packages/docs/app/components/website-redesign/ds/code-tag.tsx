import type { ReactNode } from "react";

interface CodeTagProps {
  children: ReactNode;
}

export function CodeTag({ children }: CodeTagProps) {
  return (
    <code
      style={{
        fontFamily: "var(--b-font-mono)",
        fontSize: "var(--b-t-paragraph-3)",
        color: "var(--c-green-400)",
        background: "var(--b-bg-raised)",
        border: "1px solid var(--b-border-default)",
        borderRadius: "var(--b-radius-sm)",
        padding: "1px 5px",
      }}
    >
      {children}
    </code>
  );
}
