import type { KeyboardEvent, ReactNode } from "react";

interface TabItemProps {
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
  forceState?: "active" | "hover" | "inactive";
}

function focusAdjacentTab(e: KeyboardEvent<HTMLButtonElement>, offset: number) {
  const tabItems = Array.from(
    e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button[data-tab-item="true"]') ?? [],
  );
  const currentIndex = tabItems.indexOf(e.currentTarget);
  if (currentIndex === -1) return;
  const nextIndex = (currentIndex + offset + tabItems.length) % tabItems.length;
  const nextTab = tabItems[nextIndex];
  nextTab?.focus();
  nextTab?.click();
}

export function TabItem({ active, onClick, children, forceState }: TabItemProps) {
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
      style={{
        fontFamily: "var(--b-font-mono)",
        fontSize: "var(--b-t-label-1)",
        fontWeight: 600,
        letterSpacing: "0.02em",
        padding: "8px 14px",
        border: "none",
        borderBottom: `2px solid ${isActive ? "var(--b-action-tab-indicator)" : "transparent"}`,
        background: isActive ? "var(--b-action-tab-bg-active)" : isHovered ? "var(--b-action-tab-bg-hover)" : "var(--b-action-tab-bg)",
        color: isActive ? "var(--b-action-tab-text-active)" : isHovered ? "var(--b-action-tab-text-hover)" : "var(--b-action-tab-text)",
        cursor: "pointer",
        transition: "background 0.15s, color 0.15s, border-color 0.15s",
      }}
    >
      {children}
    </button>
  );
}
