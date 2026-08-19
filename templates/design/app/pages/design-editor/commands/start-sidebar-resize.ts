import type {
  Dispatch,
  PointerEvent as ReactPointerEvent,
  RefObject,
  SetStateAction,
} from "react";

import type { DesignLeftPanel } from "@/pages/design-editor/types";

export interface StartSidebarResizeArgs {
  activeLeftPanel: DesignLeftPanel;
  leftSidebarContentRef: RefObject<HTMLDivElement | null>;
  leftSidebarWidth: number;
  rightSidebarContentRef: RefObject<HTMLDivElement | null>;
  rightSidebarWidth: number;
  setLeftSidebarWidth: Dispatch<SetStateAction<number>>;
  setRightSidebarWidth: Dispatch<SetStateAction<number>>;
}

export function runStartSidebarResize(
  {
    activeLeftPanel,
    leftSidebarContentRef,
    leftSidebarWidth,
    rightSidebarContentRef,
    rightSidebarWidth,
    setLeftSidebarWidth,
    setRightSidebarWidth,
  }: StartSidebarResizeArgs,
  side: "left" | "right",
  event: ReactPointerEvent<HTMLDivElement>,
) {
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.setPointerCapture?.(event.pointerId);
  const startX = event.clientX;
  const codePanelOpen = side === "left" && activeLeftPanel === "code";
  const startWidth =
    side === "left"
      ? codePanelOpen
        ? Math.max(leftSidebarWidth, 640)
        : Math.min(leftSidebarWidth, 420)
      : rightSidebarWidth;
  const setWidth = side === "left" ? setLeftSidebarWidth : setRightSidebarWidth;
  const minWidth = side === "left" ? (codePanelOpen ? 520 : 220) : 240;
  const maxWidth = side === "left" ? (codePanelOpen ? 1100 : 420) : 390;
  const target =
    side === "left"
      ? leftSidebarContentRef.current
      : rightSidebarContentRef.current;
  const previousTransition = target?.style.transition ?? "";
  if (target) target.style.transition = "none";
  let latestWidth = startWidth;
  const previousCursor = document.body.style.cursor;
  const previousUserSelect = document.body.style.userSelect;
  const dragShield = document.createElement("div");
  dragShield.setAttribute("data-design-sidebar-resize-shield", side);
  dragShield.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;cursor:col-resize;background:transparent;pointer-events:auto;";
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  document.body.appendChild(dragShield);

  const handleMove = (moveEvent: PointerEvent) => {
    moveEvent.preventDefault();
    const delta =
      side === "left" ? moveEvent.clientX - startX : startX - moveEvent.clientX;
    const next = Math.min(maxWidth, Math.max(minWidth, startWidth + delta));
    latestWidth = next;
    if (target) {
      target.style.width = `${next}px`;
    } else {
      // No ref available (shouldn't normally happen) — fall back to the
      // old per-move state update so resizing still works.
      setWidth(next);
    }
  };
  const cleanup = () => {
    dragShield.removeEventListener("pointermove", handleMove);
    dragShield.removeEventListener("pointerup", cleanup);
    dragShield.removeEventListener("pointercancel", cleanup);
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", cleanup);
    window.removeEventListener("pointercancel", cleanup);
    dragShield.remove();
    document.body.style.cursor = previousCursor;
    document.body.style.userSelect = previousUserSelect;
    if (target) target.style.transition = previousTransition;
    // Commit the final width to state once, on release.
    setWidth(latestWidth);
  };

  dragShield.addEventListener("pointermove", handleMove);
  dragShield.addEventListener("pointerup", cleanup);
  dragShield.addEventListener("pointercancel", cleanup);
  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", cleanup);
  window.addEventListener("pointercancel", cleanup);
}
