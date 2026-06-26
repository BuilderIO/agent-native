import { useRef, useState, useCallback, useEffect } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { prettyScreenName } from "@/lib/screen-names";
import { cn } from "@/lib/utils";

interface ScreenFile {
  id: string;
  filename: string;
  content: string;
}

interface MultiScreenCanvasProps {
  screens: ScreenFile[];
  zoom: number;
  activeId?: string | null;
  onPick: (id: string) => void;
}

/**
 * Figma-style overview canvas. Renders every file in the design as a fixed-
 * size preview iframe, laid out in a wrap-flow inside an infinite, pannable
 * surface (drag with middle mouse OR left-click on background; click a screen
 * to enter the single-file editor for that file).
 *
 * Each screen is a 320×640 thumbnail; large enough to read, small enough to
 * fit several across. The dot grid background extends well past the screens
 * so panning never reveals the page outside.
 */
const SCREEN_WIDTH = 320;
const SCREEN_HEIGHT = 640;
const SCREEN_CARD_HEIGHT = SCREEN_HEIGHT + 26;
const SCREEN_GAP = 56;
const SURFACE_PADDING = 240;

export function MultiScreenCanvas({
  screens,
  zoom,
  activeId,
  onPick,
}: MultiScreenCanvasProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragging = useRef<{ x: number; y: number } | null>(null);
  const dragCleanup = useRef<(() => void) | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Center the lineup on first mount so the user sees screens, not whitespace.
  useEffect(() => {
    if (!surfaceRef.current || screens.length === 0) return;
    const rect = surfaceRef.current.getBoundingClientRect();
    const columns = Math.min(screens.length, 3);
    const rows = Math.ceil(screens.length / columns);
    const scale = zoom / 100;
    const totalWidth = columns * SCREEN_WIDTH + (columns - 1) * SCREEN_GAP;
    const totalHeight = rows * SCREEN_CARD_HEIGHT + (rows - 1) * SCREEN_GAP;
    const visualLeft = Math.max(24, (rect.width - totalWidth * scale) / 2);
    const visualTop = Math.max(24, (rect.height - totalHeight * scale) / 2);
    setPan({
      x: visualLeft - SURFACE_PADDING * scale,
      y: visualTop - SURFACE_PADDING * scale,
    });
    // Only on mount or when screen count changes, not on every pan update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screens.length, zoom]);

  useEffect(() => {
    return () => {
      dragCleanup.current?.();
    };
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Middle mouse, or left mouse anywhere that is not a screen card.
      const target = e.target as HTMLElement;
      const onScreen = !!target.closest("[data-screen-card]");
      if (e.button !== 1 && !(e.button === 0 && !onScreen)) return;
      e.preventDefault();
      e.stopPropagation();
      const dragOrigin = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      dragging.current = dragOrigin;
      setIsDragging(true);

      const handleMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        setPan({
          x: ev.clientX - dragOrigin.x,
          y: ev.clientY - dragOrigin.y,
        });
      };

      const handleMouseUp = () => {
        dragging.current = null;
        setIsDragging(false);
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
        dragCleanup.current = null;
      };

      dragCleanup.current?.();
      dragCleanup.current = handleMouseUp;
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [pan],
  );

  return (
    <div
      ref={surfaceRef}
      className="relative h-full w-full overflow-hidden"
      onMouseDown={handleMouseDown}
      style={{ cursor: isDragging ? "grabbing" : "grab" }}
    >
      {/* Dot grid extends past the surface so panning never shows page bg. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle, hsl(var(--border)) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      {/* Lineup */}
      <div
        className="absolute"
        style={{
          left: pan.x,
          top: pan.y,
          padding: SURFACE_PADDING,
          transform: `scale(${zoom / 100})`,
          transformOrigin: "top left",
        }}
      >
        <div
          className="flex flex-wrap"
          style={{
            gap: SCREEN_GAP,
            maxWidth: SCREEN_WIDTH * 3 + SCREEN_GAP * 2,
          }}
        >
          {screens.map((screen) => (
            <Screen
              key={screen.id}
              screen={screen}
              isActive={screen.id === activeId}
              onPick={onPick}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Screen({
  screen,
  isActive,
  onPick,
}: {
  screen: ScreenFile;
  isActive: boolean;
  onPick: (id: string) => void;
}) {
  const display = prettyScreenName(screen.filename);
  return (
    <div className="flex flex-col gap-2">
      <span
        className={cn(
          "px-1 text-[11px] font-medium",
          isActive ? "text-foreground" : "text-muted-foreground",
        )}
        title={screen.filename}
      >
        {display}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            data-screen-card
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPick(screen.id);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className={cn(
              "block overflow-hidden rounded-lg border-2 bg-white shadow-2xl transition-colors",
              isActive
                ? "border-primary"
                : "border-border hover:border-muted-foreground/50",
            )}
            style={{
              width: SCREEN_WIDTH,
              height: SCREEN_HEIGHT,
              cursor: "pointer",
            }}
          >
            <iframe
              srcDoc={screen.content}
              sandbox="allow-scripts"
              className="pointer-events-none border-0"
              style={{
                width: 1280,
                height: 2560,
                transform: `scale(${SCREEN_WIDTH / 1280})`,
                transformOrigin: "top left",
              }}
              title={screen.filename}
            />
          </button>
        </TooltipTrigger>
        <TooltipContent>{`Open ${display}`}</TooltipContent>
      </Tooltip>
    </div>
  );
}
