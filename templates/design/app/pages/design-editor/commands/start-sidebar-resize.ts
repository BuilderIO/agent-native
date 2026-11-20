import type {
  Dispatch,
  PointerEvent as ReactPointerEvent,
  RefObject,
  SetStateAction,
} from "react";

import {
  resolveInspectorWidth,
  snapInspectorDragWidth,
} from "@/pages/design-editor/inspector-width";
import {
  resolveLeftSidebarWidth,
  snapLeftSidebarDragWidth,
} from "@/pages/design-editor/left-sidebar-width";

export interface StartSidebarResizeArgs {
  leftSidebarContentRef: RefObject<HTMLDivElement | null>;
  leftSidebarWidth: number;
  rightSidebarContentRef: RefObject<HTMLDivElement | null>;
  rightSidebarWidth: number;
  setLeftSidebarWidth: Dispatch<SetStateAction<number>>;
  setRightSidebarWidth: Dispatch<SetStateAction<number>>;
  commitLeftSidebarWidth: (width: number) => void;
  commitRightSidebarWidth: (width: number) => void;
}

export function runStartSidebarResize(
  {
    leftSidebarContentRef,
    leftSidebarWidth,
    rightSidebarContentRef,
    rightSidebarWidth,
    setLeftSidebarWidth,
    setRightSidebarWidth,
    commitLeftSidebarWidth,
    commitRightSidebarWidth,
  }: StartSidebarResizeArgs,
  side: "left" | "right",
  event: ReactPointerEvent<HTMLDivElement>,
) {
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.setPointerCapture?.(event.pointerId);
  const startX = event.clientX;
  const startWidth =
    side === "left"
      ? resolveLeftSidebarWidth(leftSidebarWidth)
      : resolveInspectorWidth(rightSidebarWidth);
  const setWidth = side === "left" ? setLeftSidebarWidth : setRightSidebarWidth;
  const commitWidth =
    side === "left" ? commitLeftSidebarWidth : commitRightSidebarWidth;
  const target =
    side === "left"
      ? leftSidebarContentRef.current
      : rightSidebarContentRef.current;
  const previousTransition = target?.style.transition ?? "";
  if (target) target.style.transition = "none";
  let latestWidth = startWidth;
  let pendingFrame: number | null = null;
  const syncWidthState = () => {
    pendingFrame = null;
    setWidth(latestWidth);
  };
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
    const next =
      side === "left"
        ? snapLeftSidebarDragWidth(startWidth + delta)
        : snapInspectorDragWidth(startWidth + delta);
    if (next === latestWidth) return;
    latestWidth = next;
    if (target) {
      target.style.width = `${next}px`;
    }
    if (pendingFrame !== null) {
      window.cancelAnimationFrame(pendingFrame);
    }
    pendingFrame = window.requestAnimationFrame(syncWidthState);
  };
  const cleanup = () => {
    dragShield.removeEventListener("pointermove", handleMove);
    dragShield.removeEventListener("pointerup", cleanup);
    dragShield.removeEventListener("pointercancel", cleanup);
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", cleanup);
    window.removeEventListener("pointercancel", cleanup);
    if (pendingFrame !== null) {
      window.cancelAnimationFrame(pendingFrame);
      pendingFrame = null;
    }
    dragShield.remove();
    document.body.style.cursor = previousCursor;
    document.body.style.userSelect = previousUserSelect;
    if (target) target.style.transition = previousTransition;
    commitWidth(latestWidth);
  };

  dragShield.addEventListener("pointermove", handleMove);
  dragShield.addEventListener("pointerup", cleanup);
  dragShield.addEventListener("pointercancel", cleanup);
  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", cleanup);
  window.addEventListener("pointercancel", cleanup);
}
