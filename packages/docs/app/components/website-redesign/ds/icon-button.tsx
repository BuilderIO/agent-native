import { IconMoon, IconSun } from "@tabler/icons-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import { useDocsTheme } from "../../ThemeToggle";

// background/border-color live in classes, not inline style, so the real
// :hover pseudo-class can win — inline style beats a stylesheet rule
// regardless of specificity, which would make hover: classes inert.
const interactiveClassName =
  "border-[var(--b-action-secondary-border)] hover:bg-[var(--b-action-secondary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-text-primary)]";

export function IconButton({
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      type="button"
      className={
        className ? `${interactiveClassName} ${className}` : interactiveClassName
      }
      style={{
        width: 40,
        height: 40,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        borderWidth: 1,
        borderStyle: "solid",
        borderRadius: "var(--b-radius)",
        background: "transparent",
        color: "var(--b-text-primary)",
        cursor: "pointer",
        outline: "none",
        transition: "background 0.15s, border-color 0.15s",
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

export function ThemeIconButton() {
  const { theme, toggleTheme } = useDocsTheme();
  return (
    <IconButton
      onClick={toggleTheme}
      aria-label="Toggle theme"
      title="Toggle theme"
    >
      {theme === "light" ? (
        <IconSun size={18} stroke={1.5} />
      ) : (
        <IconMoon size={18} stroke={1.5} />
      )}
    </IconButton>
  );
}
