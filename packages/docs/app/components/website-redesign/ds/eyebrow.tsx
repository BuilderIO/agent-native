import type { ReactNode } from "react";

interface EyebrowProps {
  children: ReactNode;
}

export function Eyebrow({ children }: EyebrowProps) {
  return (
    <p
      className="m-0 uppercase"
      style={{
        fontFamily: "var(--b-font-mono)",
        fontSize: "var(--b-t-label-1)",
        fontWeight: 600,
        color: "var(--b-text-eyebrow)",
        letterSpacing: "0.08em",
      }}
    >
      {children}
    </p>
  );
}
