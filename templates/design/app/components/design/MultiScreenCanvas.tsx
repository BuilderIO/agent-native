import { useRef, useState, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { prettyScreenName } from "@/lib/screen-names";

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
  const [isDragging, setIsDragging] = useState(false);

  // Center the lineup on first mount so the user sees screens, not whitespace.
  useEffect(() => {
    if (!surfaceRef.current || screens.length === 0) return;
    const rect = surfaceRef.current.getBoundingClientRect();
    const totalWidth =
      Math.min(screens.length, 3) * SCREEN_WIDTH +
      (Math.min(screens.length, 3) - 1) * SCREEN_GAP;
    setPan({
      x: Math.max(0, (rect.width - totalWidth) / 2 - SURFACE_PADDING),
      y: SURFACE_PADDING / 2,
    });
    // Only on mount or when screen count changes, not on every pan update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screens.length]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Middle mouse, or left mouse on the surface background (not on a screen)
      const target = e.target as HTMLElement;
      const onBackground = target === e.currentTarget;
      if (e.button !== 1 && !(e.button === 0 && onBackground)) return;
      e.preventDefault();
      dragging.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      setIsDragging(true);
    },
    [pan],
  );

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging.current) return;
    setPan({
      x: e.clientX - dragging.current.x,
      y: e.clientY - dragging.current.y,
    });
  }, []);

  const handleMouseUp = useCallback(() => {
    dragging.current = null;
    setIsDragging(false);
  }, []);

  return (
    <div
      ref={surfaceRef}
      className="relative h-full w-full overflow-hidden"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
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
      <button
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
        title={`Open ${display}`}
      >
        <iframe
          srcDoc={screen.content}
          sandbox="allow-scripts allow-same-origin"
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
    </div>
  );
}
