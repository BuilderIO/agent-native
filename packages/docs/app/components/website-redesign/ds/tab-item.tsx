import type { KeyboardEvent, ReactNode } from "react";

interface TabItemProps {
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
  forceState?: "active" | "hover" | "inactive";
}

const TAB_BUTTON_SELECTOR = "button[data-tab-item=true]";

function focusAdjacentTab(e: KeyboardEvent<HTMLButtonElement>, offset: number) {
  // TabItem is sometimes wrapped in its own div for per-tab borders, so the
  // immediate parent may only contain this one button. Walk up to the
  // shared tablist ancestor first and fall back to the direct parent when
  // there isn't one (e.g. a bare row of tabs).
  const scope =
    e.currentTarget.closest('[role="tablist"]') ??
    e.currentTarget.parentElement;
  const tabItems = Array.from(
    scope?.querySelectorAll<HTMLButtonElement>(TAB_BUTTON_SELECTOR) ?? [],
  );
  const currentIndex = tabItems.indexOf(e.currentTarget);
  if (currentIndex === -1) return;
  const nextIndex = (currentIndex + offset + tabItems.length) % tabItems.length;
  const nextTab = tabItems[nextIndex];
  nextTab?.focus();
  nextTab?.click();
}

export function TabItem({
  active,
  onClick,
  children,
  forceState,
}: TabItemProps) {
  const isActive = forceState ? forceState === "active" : active;
  const isHovered = forceState === "hover";

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      focusAdjacentTab(e, -1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      focusAdjacentTab(e, 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick();
    }
  }

  return (
    <button
      type="button"
      data-tab-item="true"
      role="tab"
      aria-selected={isActive}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      className={
        // background/color live in classes (not inline style) so the real
        // :hover pseudo-class can win over the base color.
        (isActive
          ? "bg-[var(--b-action-tab-bg-active)] text-[var(--b-action-tab-text-active)]"
          : "bg-[var(--b-action-tab-bg)] text-[var(--b-action-tab-text)] hover:bg-[var(--b-action-tab-bg-hover)] hover:text-[var(--b-action-tab-text-hover)]") +
        " focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--b-text-primary)]"
      }
      style={{
        fontFamily: "var(--b-font-mono)",
        fontSize: "var(--b-t-label-1)",
        fontWeight: 600,
        letterSpacing: "0.02em",
        padding: "14px 14px",
        border: "none",
        outline: "none",
        boxShadow: isActive
          ? "inset 0 -2px 0 0 var(--b-action-tab-indicator)"
          : "none",
        cursor: "pointer",
        transition: "background 0.15s, color 0.15s",
        // Showcase-only: forceState="hover" must render regardless of real
        // mouse position, so it deliberately forces color via inline style.
        ...(isHovered && {
          background: "var(--b-action-tab-bg-hover)",
          color: "var(--b-action-tab-text-hover)",
        }),
      }}
    >
      {children}
    </button>
  );
}
