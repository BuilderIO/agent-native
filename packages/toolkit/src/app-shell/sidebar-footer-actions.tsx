import type { ReactNode } from "react";

import { cn } from "../utils.js";

export interface SidebarFooterActionsProps {
  feedback?: ReactNode;
  translate?: ReactNode;
  search?: ReactNode;
  collapse?: ReactNode;
  collapsed?: boolean;
  className?: string;
}

/**
 * Keeps the shared left-sidebar utility order stable while apps provide their
 * own controls and behavior.
 */
export function SidebarFooterActions({
  feedback,
  translate,
  search,
  collapse,
  collapsed = false,
  className,
}: SidebarFooterActionsProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-1",
        collapsed
          ? "flex-col px-1 py-1"
          : "min-w-0 justify-end px-3 py-2",
        className,
      )}
      data-sidebar-footer-actions
    >
      {feedback ? (
        <div
          className={cn("min-w-0", !collapsed && "flex-1")}
          data-sidebar-footer-feedback
        >
          {feedback}
        </div>
      ) : null}
      {translate ? (
        <div data-sidebar-footer-translate>{translate}</div>
      ) : null}
      {search ? <div data-sidebar-footer-search>{search}</div> : null}
      {collapse ? <div data-sidebar-footer-collapse>{collapse}</div> : null}
    </div>
  );
}
