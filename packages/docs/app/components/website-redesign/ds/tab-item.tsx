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
  const forceAttr = forceState === "hover" ? "hover" : undefined;

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
      data-force={forceAttr}
      className={[
        "cursor-pointer border-none p-[14px] font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-label-1)] font-semibold tracking-[0.02em] outline-none transition-[background,color] duration-150 ease-[ease]",
        // background/color live in classes (not inline style) so the real
        // :hover pseudo-class can win over the base color. Showcase-only:
        // forceState="hover" has to render the hover look with the mouse
        // elsewhere, so each hover rule is mirrored onto a `data-[force=hover]:`
        // variant rather than forced inline, which would beat the real :hover.
        isActive
          ? "bg-[var(--b-action-tab-bg-active)] text-[var(--b-action-tab-text-active)] shadow-[inset_0_-2px_0_0_var(--b-action-tab-indicator)]"
          : "bg-[var(--b-action-tab-bg)] text-[var(--b-action-tab-text)] shadow-none hover:bg-[var(--b-action-tab-bg-hover)] hover:text-[var(--b-action-tab-text-hover)] data-[force=hover]:bg-[var(--b-action-tab-bg-hover)] data-[force=hover]:text-[var(--b-action-tab-text-hover)]",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--b-text-primary)]",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
