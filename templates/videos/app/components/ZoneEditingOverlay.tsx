/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ZONE EDITING OVERLAY
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Interactive overlay for visually editing hover detection zones.
 * Works even when the video is paused, unlike in-composition rendering.
 *
 * Press 'D' key to toggle debug mode on/off.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useEffect, useState, useRef, useCallback } from "react";

interface Zone {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ZoneEditingOverlayProps {
  compositionId: string;
  compositionWidth: number;
  compositionHeight: number;
  enabled?: boolean;
}

type DragMode =
  | "move"
  | "resize-se"
  | "resize-sw"
  | "resize-ne"
  | "resize-nw"
  | null;

const STORAGE_KEY_PREFIX = "videos-debug-zones:";

// Default zones for projects-interactive composition
const DEFAULT_ZONES: Record<string, Zone> = {
  Input: { x: 679, y: 285, width: 718, height: 100 },
  Cog: { x: 679, y: 404, width: 30, height: 30 },
  React: { x: 715, y: 404, width: 140, height: 30 },
  "1x": { x: 1277, y: 404, width: 55, height: 30 },
  Build: { x: 1354, y: 404, width: 102, height: 30 },
  Send: { x: 1478, y: 404, width: 29, height: 29 },
};

const ZONE_COLORS: Record<string, string> = {
  Input: "rgba(0, 255, 0, 0.3)",
  Cog: "rgba(255, 255, 0, 0.3)",
  React: "rgba(255, 0, 255, 0.3)",
  "1x": "rgba(0, 255, 255, 0.3)",
  Build: "rgba(255, 100, 0, 0.5)",
  Send: "rgba(100, 255, 100, 0.3)",
};

export const ZoneEditingOverlay: React.FC<ZoneEditingOverlayProps> = ({
  compositionId,
  compositionWidth,
  compositionHeight,
  enabled = true,
}) => {
  const [debugMode, setDebugMode] = useState(false);
  const [zones, setZones] = useState<Record<string, Zone>>(() => {
    // Load from localStorage or use defaults
    const stored = localStorage.getItem(STORAGE_KEY_PREFIX + compositionId);
    return stored ? JSON.parse(stored) : DEFAULT_ZONES;
  });

  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [hoveredZone, setHoveredZone] = useState<string | null>(null);
  const [dragMode, setDragMode] = useState<DragMode>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [originalZone, setOriginalZone] = useState<Zone | null>(null);

  // Save zones to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY_PREFIX + compositionId,
      JSON.stringify(zones),
    );
  }, [zones, compositionId]);

  // Keyboard shortcut to toggle debug mode
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === "d" || e.key === "D") {
        setDebugMode((prev) => {
          console.log(`🔧 Debug mode: ${!prev ? "ON" : "OFF"}`);
          if (!prev) {
            console.log("Zones:", zones);
          }
          return !prev;
        });
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [zones]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, zoneKey: string, mode: DragMode) => {
      e.preventDefault();
      e.stopPropagation();

      setSelectedZone(zoneKey);
      setDragMode(mode);
      setDragStart({ x: e.clientX, y: e.clientY });
      setOriginalZone({ ...zones[zoneKey] });
    },
    [zones],
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!dragMode || !dragStart || !originalZone || !selectedZone) return;

      const deltaX = e.clientX - dragStart.x;
      const deltaY = e.clientY - dragStart.y;

      let newZone: Zone = { ...originalZone };

      if (dragMode === "move") {
        newZone.x = originalZone.x + deltaX;
        newZone.y = originalZone.y + deltaY;
      } else if (dragMode === "resize-se") {
        newZone.width = Math.max(20, originalZone.width + deltaX);
        newZone.height = Math.max(20, originalZone.height + deltaY);
      } else if (dragMode === "resize-sw") {
        newZone.x = originalZone.x + deltaX;
        newZone.width = Math.max(20, originalZone.width - deltaX);
        newZone.height = Math.max(20, originalZone.height + deltaY);
      } else if (dragMode === "resize-ne") {
        newZone.width = Math.max(20, originalZone.width + deltaX);
        newZone.y = originalZone.y + deltaY;
        newZone.height = Math.max(20, originalZone.height - deltaY);
      } else if (dragMode === "resize-nw") {
        newZone.x = originalZone.x + deltaX;
        newZone.y = originalZone.y + deltaY;
        newZone.width = Math.max(20, originalZone.width - deltaX);
        newZone.height = Math.max(20, originalZone.height - deltaY);
      }

      setZones((prev) => ({
        ...prev,
        [selectedZone]: newZone,
      }));
    },
    [dragMode, dragStart, originalZone, selectedZone],
  );

  const handleMouseUp = useCallback(() => {
    if (selectedZone && zones[selectedZone]) {
      const zone = zones[selectedZone];
      console.log(
        `"${selectedZone}": { x: ${Math.round(zone.x)}, y: ${Math.round(zone.y)}, width: ${Math.round(zone.width)}, height: ${Math.round(zone.height)} },`,
      );
    }

    setDragMode(null);
    setDragStart(null);
    setOriginalZone(null);
  }, [selectedZone, zones]);

  useEffect(() => {
    if (dragMode) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [dragMode, handleMouseMove, handleMouseUp]);

  if (!enabled || !debugMode) return null;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 100,
      }}
    >
      {/* Debug banner */}
      <div
        style={{
          position: "absolute",
          top: 20,
          left: "50%",
          transform: "translateX(-50%)",
          backgroundColor: "rgba(255, 100, 0, 0.95)",
          color: "white",
          padding: "12px 24px",
          borderRadius: 8,
          fontSize: 14,
          fontWeight: "bold",
          fontFamily: "Inter, sans-serif",
          zIndex: 10000,
          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.5)",
          pointerEvents: "none",
        }}
      >
        🔧 DEBUG MODE - Press 'D' to toggle | Drag zones to reposition | Drag
        corners to resize
      </div>

      {/* Zones */}
      {Object.entries(zones).map(([label, zone]) => {
        const isSelected = selectedZone === label;
        const isHovered = hoveredZone === label;
        const color = ZONE_COLORS[label] || "rgba(255, 255, 255, 0.3)";

        return (
          <div
            key={label}
            style={{
              position: "absolute",
              left: zone.x,
              top: zone.y,
              width: zone.width,
              height: zone.height,
              pointerEvents: "auto",
            }}
            onMouseEnter={() => setHoveredZone(label)}
            onMouseLeave={() => setHoveredZone(null)}
          >
            {/* Main zone area */}
            <div
              onMouseDown={(e) => handleMouseDown(e, label, "move")}
              style={{
                position: "absolute",
                inset: 0,
                backgroundColor: color,
                border: `2px solid ${isSelected ? "yellow" : isHovered ? "white" : "red"}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                color: "white",
                fontWeight: "bold",
                textShadow: "0 0 3px black",
                cursor: dragMode ? "grabbing" : "grab",
                userSelect: "none",
                fontFamily: "Inter, sans-serif",
              }}
            >
              {label}
              <div
                style={{
                  position: "absolute",
                  top: 2,
                  right: 2,
                  fontSize: 9,
                  opacity: 0.9,
                }}
              >
                {Math.round(zone.x)}, {Math.round(zone.y)}
              </div>
              <div
                style={{
                  position: "absolute",
                  bottom: 2,
                  right: 2,
                  fontSize: 9,
                  opacity: 0.9,
                }}
              >
                {Math.round(zone.width)}×{Math.round(zone.height)}
              </div>
            </div>

            {/* Resize handles */}
            {(isSelected || isHovered) && (
              <>
                <div
                  onMouseDown={(e) => handleMouseDown(e, label, "resize-se")}
                  style={{
                    position: "absolute",
                    right: -4,
                    bottom: -4,
                    width: 8,
                    height: 8,
                    backgroundColor: "yellow",
                    border: "1px solid black",
                    cursor: "nwse-resize",
                    zIndex: 10,
                  }}
                />
                <div
                  onMouseDown={(e) => handleMouseDown(e, label, "resize-sw")}
                  style={{
                    position: "absolute",
                    left: -4,
                    bottom: -4,
                    width: 8,
                    height: 8,
                    backgroundColor: "yellow",
                    border: "1px solid black",
                    cursor: "nesw-resize",
                    zIndex: 10,
                  }}
                />
                <div
                  onMouseDown={(e) => handleMouseDown(e, label, "resize-ne")}
                  style={{
                    position: "absolute",
                    right: -4,
                    top: -4,
                    width: 8,
                    height: 8,
                    backgroundColor: "yellow",
                    border: "1px solid black",
                    cursor: "nesw-resize",
                    zIndex: 10,
                  }}
                />
                <div
                  onMouseDown={(e) => handleMouseDown(e, label, "resize-nw")}
                  style={{
                    position: "absolute",
                    left: -4,
                    top: -4,
                    width: 8,
                    height: 8,
                    backgroundColor: "yellow",
                    border: "1px solid black",
                    cursor: "nwse-resize",
                    zIndex: 10,
                  }}
                />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
};
