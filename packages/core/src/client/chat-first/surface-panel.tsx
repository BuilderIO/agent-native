import type { CSSProperties, PointerEvent, ReactNode } from "react";

import { clampChatFirstSurfaceWidth } from "../chat-first.js";
import { defaultChatFirstCopy } from "./copy.js";
import type { ChatFirstCopy } from "./types.js";

export interface ChatFirstSurfacePanelProps {
  width: number;
  onResizePointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  children: ReactNode;
  copy?: ChatFirstCopy;
}

export function ChatFirstSurfacePanel({
  width,
  onResizePointerDown,
  children,
  copy = defaultChatFirstCopy,
}: ChatFirstSurfacePanelProps) {
  const panelWidth = clampChatFirstSurfaceWidth(width);

  return (
    <aside
      data-chat-first-surface-panel
      aria-label={copy("sideSurfaces")}
      className="chat-first-surface-panel relative flex h-full w-[var(--chat-first-surface-width)] min-w-0 shrink-0 flex-col overflow-hidden border-s border-border bg-background max-[767px]:absolute max-[767px]:inset-0 max-[767px]:z-10 max-[767px]:w-full max-[767px]:min-w-0"
      style={
        {
          "--chat-first-surface-width": `${panelWidth}px`,
        } as CSSProperties
      }
    >
      <div
        className="chat-first-surface-resize-handle absolute inset-y-0 -start-1 z-[3] w-2 cursor-col-resize hover:bg-ring/35 max-[767px]:hidden"
        role="separator"
        aria-label={copy("resizeSideSurface")}
        aria-orientation="vertical"
        onPointerDown={onResizePointerDown}
      />
      {children}
    </aside>
  );
}
