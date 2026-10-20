import { useState, type ReactNode } from "react";

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
}

export function Tooltip({ content, children }: TooltipProps) {
  const [open, setOpen] = useState(false);

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className="absolute bottom-[calc(100%+6px)] left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-[var(--b-radius-sm)] bg-[var(--b-bg-prominent)] px-2 py-1 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-label-2)] text-[var(--b-text-primary)]"
        >
          {content}
        </span>
      )}
    </span>
  );
}
