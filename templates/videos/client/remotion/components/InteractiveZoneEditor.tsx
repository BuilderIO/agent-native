/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INTERACTIVE ZONE EDITOR
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Visual editor for adjusting hover detection zones via drag-and-drop.
 *
 * Features:
 * - Click and drag zones to reposition
 * - Drag corners/edges to resize
 * - Real-time coordinate display
 * - Copy zone values for code
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React from "react";

export interface Zone {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ZoneConfig {
  zone: Zone;
  label: string;
  color: string;
}

interface InteractiveZoneEditorProps {
  zones: ZoneConfig[];
  onZoneChange?: (label: string, newZone: Zone) => void;
  enabled?: boolean;
}

type DragMode =
  | "move"
  | "resize-se"
  | "resize-sw"
  | "resize-ne"
  | "resize-nw"
  | null;

export const InteractiveZoneEditor: React.FC<InteractiveZoneEditorProps> = ({
  zones,
  onZoneChange,
  enabled = true,
}) => {
  const [selectedZone, setSelectedZone] = React.useState<string | null>(null);
  const [dragMode, setDragMode] = React.useState<DragMode>(null);
  const [dragStart, setDragStart] = React.useState<{
    x: number;
    y: number;
  } | null>(null);
  const [originalZone, setOriginalZone] = React.useState<Zone | null>(null);
  const [hoveredZone, setHoveredZone] = React.useState<string | null>(null);

  if (!enabled) {
    return (
      <>
        {zones.map(({ zone, label, color }) => (
          <div
            key={label}
            style={{
              position: "absolute",
              left: zone.x,
              top: zone.y,
              width: zone.width,
              height: zone.height,
              backgroundColor: color,
              border: "2px solid red",
              pointerEvents: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 10,
              color: "white",
              fontWeight: "bold",
              textShadow: "0 0 3px black",
            }}
          >
            {label}
          </div>
        ))}
      </>
    );
  }

  const handleMouseDown = (
    e: React.MouseEvent,
    label: string,
    mode: DragMode,
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const zoneConfig = zones.find((z) => z.label === label);
    if (!zoneConfig) return;

    setSelectedZone(label);
    setDragMode(mode);
    setDragStart({ x: e.clientX, y: e.clientY });
    setOriginalZone({ ...zoneConfig.zone });
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!dragMode || !dragStart || !originalZone || !selectedZone) return;

    const deltaX = e.clientX - dragStart.x;
    const deltaY = e.clientY - dragStart.y;

    let newZone: Zone = { ...originalZone };

    if (dragMode === "move") {
      newZone.x = originalZone.x + deltaX;
      newZone.y = originalZone.y + deltaY;
    } else if (dragMode === "resize-se") {
      // Southeast corner - increase width/height
      newZone.width = Math.max(20, originalZone.width + deltaX);
      newZone.height = Math.max(20, originalZone.height + deltaY);
    } else if (dragMode === "resize-sw") {
      // Southwest corner - move x, increase width (opposite), increase height
      newZone.x = originalZone.x + deltaX;
      newZone.width = Math.max(20, originalZone.width - deltaX);
      newZone.height = Math.max(20, originalZone.height + deltaY);
    } else if (dragMode === "resize-ne") {
      // Northeast corner - increase width, move y, increase height (opposite)
      newZone.width = Math.max(20, originalZone.width + deltaX);
      newZone.y = originalZone.y + deltaY;
      newZone.height = Math.max(20, originalZone.height - deltaY);
    } else if (dragMode === "resize-nw") {
      // Northwest corner - move both x/y, decrease both width/height
      newZone.x = originalZone.x + deltaX;
      newZone.y = originalZone.y + deltaY;
      newZone.width = Math.max(20, originalZone.width - deltaX);
      newZone.height = Math.max(20, originalZone.height - deltaY);
    }

    onZoneChange?.(selectedZone, newZone);
  };

  const handleMouseUp = () => {
    if (selectedZone && originalZone) {
      // Log final zone values for easy copying
      const zoneConfig = zones.find((z) => z.label === selectedZone);
      if (zoneConfig) {
        console.log(`${selectedZone} zone:`, {
          x: Math.round(zoneConfig.zone.x),
          y: Math.round(zoneConfig.zone.y),
          width: Math.round(zoneConfig.zone.width),
          height: Math.round(zoneConfig.zone.height),
        });
      }
    }

    setDragMode(null);
    setDragStart(null);
    setOriginalZone(null);
  };

  React.useEffect(() => {
    if (dragMode) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [dragMode, dragStart, originalZone, selectedZone]);

  return (
    <>
      {zones.map(({ zone, label, color }) => {
        const isSelected = selectedZone === label;
        const isHovered = hoveredZone === label;

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
            {/* Main zone area - drag to move */}
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
                fontSize: 10,
                color: "white",
                fontWeight: "bold",
                textShadow: "0 0 3px black",
                cursor: dragMode ? "grabbing" : "grab",
                userSelect: "none",
              }}
            >
              {label}
              <div
                style={{
                  position: "absolute",
                  top: 2,
                  right: 2,
                  fontSize: 8,
                  opacity: 0.8,
                }}
              >
                {Math.round(zone.x)}, {Math.round(zone.y)}
              </div>
              <div
                style={{
                  position: "absolute",
                  bottom: 2,
                  right: 2,
                  fontSize: 8,
                  opacity: 0.8,
                }}
              >
                {Math.round(zone.width)}×{Math.round(zone.height)}
              </div>
            </div>

            {/* Resize handles */}
            {(isSelected || isHovered) && (
              <>
                {/* Southeast corner */}
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

                {/* Southwest corner */}
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

                {/* Northeast corner */}
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

                {/* Northwest corner */}
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
    </>
  );
};
