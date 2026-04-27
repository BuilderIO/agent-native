import type { ReactNode } from "react";
import type { DeviceFrameType } from "./types";

interface DeviceFrameProps {
  type: DeviceFrameType;
  children: ReactNode;
  title?: string;
}

/** macOS window chrome with traffic light dots */
function DesktopFrame({
  children,
  title,
}: {
  children: ReactNode;
  title?: string;
}) {
  return (
    <div className="rounded-lg overflow-hidden shadow-2xl border border-border bg-background">
      {/* Title bar */}
      <div className="flex items-center gap-2 px-4 h-10 bg-muted/50 border-b border-border">
        {/* Traffic lights */}
        <div className="flex items-center gap-1.5">
          <div
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: "#FF5F57" }}
          />
          <div
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: "#FEBC2E" }}
          />
          <div
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: "#28C840" }}
          />
        </div>
        {title && (
          <span className="flex-1 text-center text-xs text-muted-foreground truncate">
            {title}
          </span>
        )}
      </div>
      {/* Content */}
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}

/** iPad-like tablet frame */
function TabletFrame({
  children,
  title,
}: {
  children: ReactNode;
  title?: string;
}) {
  return (
    <div className="rounded-[2rem] overflow-hidden shadow-2xl border-[3px] border-zinc-700 bg-zinc-900">
      {/* Camera notch area */}
      <div className="flex items-center justify-center h-5 bg-zinc-900">
        <div className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
      </div>
      {/* Screen */}
      <div className="mx-1 overflow-hidden">
        {title && (
          <div className="text-center text-[10px] text-muted-foreground py-1 bg-black/40">
            {title}
          </div>
        )}
        {children}
      </div>
      {/* Home bar */}
      <div className="flex items-center justify-center h-5 bg-zinc-900">
        <div className="w-24 h-1 rounded-full bg-zinc-700" />
      </div>
    </div>
  );
}

/** iPhone-like mobile frame */
function MobileFrame({
  children,
  title,
}: {
  children: ReactNode;
  title?: string;
}) {
  return (
    <div className="rounded-[2.5rem] overflow-hidden shadow-2xl border-[3px] border-zinc-700 bg-zinc-900">
      {/* Status bar with notch */}
      <div className="relative flex items-center justify-between px-6 h-10 bg-black">
        {/* Time */}
        <span className="text-[11px] font-semibold text-white">9:41</span>
        {/* Dynamic Island / Notch */}
        <div className="absolute left-1/2 -translate-x-1/2 top-1.5 w-24 h-6 rounded-full bg-zinc-900" />
        {/* Status icons */}
        <div className="flex items-center gap-1">
          {/* Signal bars */}
          <svg
            width="16"
            height="12"
            viewBox="0 0 16 12"
            className="text-white"
          >
            <rect x="0" y="8" width="3" height="4" fill="currentColor" />
            <rect x="4" y="5" width="3" height="7" fill="currentColor" />
            <rect x="8" y="2" width="3" height="10" fill="currentColor" />
            <rect x="12" y="0" width="3" height="12" fill="currentColor" />
          </svg>
          {/* Battery */}
          <svg
            width="22"
            height="12"
            viewBox="0 0 22 12"
            className="text-white"
          >
            <rect
              x="0"
              y="1"
              width="18"
              height="10"
              rx="2"
              stroke="currentColor"
              fill="none"
              strokeWidth="1"
            />
            <rect
              x="2"
              y="3"
              width="14"
              height="6"
              rx="1"
              fill="currentColor"
            />
            <rect
              x="19"
              y="4"
              width="2"
              height="4"
              rx="0.5"
              fill="currentColor"
            />
          </svg>
        </div>
      </div>
      {/* Screen */}
      <div className="mx-0.5 overflow-hidden">
        {title && (
          <div className="text-center text-[10px] text-muted-foreground py-1 bg-black/40">
            {title}
          </div>
        )}
        {children}
      </div>
      {/* Home indicator */}
      <div className="flex items-center justify-center h-6 bg-black">
        <div className="w-28 h-1 rounded-full bg-zinc-600" />
      </div>
    </div>
  );
}

export function DeviceFrame({ type, children, title }: DeviceFrameProps) {
  switch (type) {
    case "desktop":
      return <DesktopFrame title={title}>{children}</DesktopFrame>;
    case "tablet":
      return <TabletFrame title={title}>{children}</TabletFrame>;
    case "mobile":
      return <MobileFrame title={title}>{children}</MobileFrame>;
    default:
      return <>{children}</>;
  }
}
