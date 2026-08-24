import type { ReactNode } from "react";

interface IconBoxProps {
  children: ReactNode;
}

export function IconBox({ children }: IconBoxProps) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 40,
        height: 40,
        borderRadius: "var(--b-radius)",
        background: "var(--b-bg-prominent)",
        border: "1px solid var(--b-border-default)",
        color: "var(--b-text-eyebrow)",
      }}
    >
      {children}
    </div>
  );
}
