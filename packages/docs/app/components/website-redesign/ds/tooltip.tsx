import { useState, type ReactNode } from "react";

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
}

export function Tooltip({ content, children }: TooltipProps) {
  const [open, setOpen] = useState(false);

  return (
    <span
      style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            left: "50%",
            transform: "translateX(-50%)",
            background: "var(--b-bg-prominent)",
            color: "var(--b-text-primary)",
            fontSize: "var(--b-t-label-2)",
            fontFamily: "var(--b-font-sans)",
            padding: "4px 8px",
            borderRadius: "var(--b-radius-sm)",
            whiteSpace: "nowrap",
            zIndex: 10,
          }}
        >
          {content}
        </span>
      )}
    </span>
  );
}
