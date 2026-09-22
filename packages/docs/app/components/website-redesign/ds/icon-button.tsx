import { useT } from "@agent-native/core/client/i18n";
import { IconMoon, IconSun } from "@tabler/icons-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import { useDocsTheme } from "../../ThemeToggle";

// background/border-color live in classes, not inline style, so the real
// :hover pseudo-class can win — inline style beats a stylesheet rule
// regardless of specificity, which would make hover: classes inert.
const interactiveClassName =
  "hover:bg-[var(--b-action-secondary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-text-primary)]";

// Everything but the 40x40 sizing, so a text control in the footer can sit
// beside these icon buttons and read as the same surface.
export const controlSurfaceClassName =
  "inline-flex h-10 shrink-0 cursor-pointer items-center justify-center rounded-[var(--b-radius)] border border-solid border-[var(--b-border-default)] bg-transparent text-[var(--b-text-primary)] outline-none transition-[background,border-color] duration-150 ease-[ease] hover:bg-[var(--b-action-secondary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-text-primary)]";

const baseClassName =
  "inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-[var(--b-radius)] border border-solid bg-transparent text-[var(--b-text-primary)] outline-none transition-[background,border-color] duration-150 ease-[ease]";

export function IconButton({
  children,
  className,
  dimBorder,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  dimBorder?: boolean;
}) {
  return (
    <button
      type="button"
      className={[
        baseClassName,
        interactiveClassName,
        dimBorder
          ? "border-[var(--b-action-secondary-border-dim)]"
          : "border-[var(--b-border-default)]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {children}
    </button>
  );
}

export function ThemeIconButton({ dimBorder }: { dimBorder?: boolean }) {
  const t = useT();
  const { theme, toggleTheme } = useDocsTheme();
  const label = t("theme.toggle");
  return (
    <IconButton
      dimBorder={dimBorder}
      onClick={toggleTheme}
      aria-label={label}
      title={label}
    >
      {theme === "light" ? (
        <IconSun size={18} stroke={1.5} />
      ) : (
        <IconMoon size={18} stroke={1.5} />
      )}
    </IconButton>
  );
}
