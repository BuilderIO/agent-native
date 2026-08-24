import type { ReactNode } from "react";

interface CategoryProps {
  children: ReactNode;
}

export function Category({ children }: CategoryProps) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontFamily: "var(--b-font-mono)",
        fontSize: "var(--b-t-label-2)",
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: "var(--b-text-secondary)",
        background: "var(--b-bg-prominent)",
        border: "1px solid var(--b-border-default)",
        borderRadius: "var(--b-radius-full)",
        padding: "3px 10px",
      }}
    >
      {children}
    </span>
  );
}
