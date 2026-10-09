import type { ReactNode } from "react";

// Height matches the workspace rail's logo row and the agent panel's top bar so
// the three bottom borders form one line across the left chrome.
export function LeftPanelHeader({
  title,
  children,
}: {
  title?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      data-design-chrome-region="left-header"
      className="flex h-12 shrink-0 items-center gap-[var(--design-baseline-half)] border-b border-[var(--design-editor-panel-divider-color)] px-[var(--design-baseline-unit)]"
    >
      {title ? (
        <h3 className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
          {title}
        </h3>
      ) : null}
      {children}
    </div>
  );
}
