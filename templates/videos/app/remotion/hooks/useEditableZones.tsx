import { useState, useEffect, useCallback } from "react";

export type Zone = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ZoneMap = Record<string, Zone>;

export type UseEditableZonesConfig = {
  componentId: string;
  defaultZones: ZoneMap;
  enabled?: boolean;
};

type DragMode = "move" | "resize-nw" | "resize-ne" | "resize-sw" | "resize-se";

type DragState = {
  zoneLabel: string;
  mode: DragMode;
  startX: number;
  startY: number;
  startZone: Zone;
};

export const useEditableZones = (config: UseEditableZonesConfig) => {
  const { componentId, defaultZones, enabled = false } = config;
  const storageKey = `videos-zones:${componentId}`;

  const [zones, setZones] = useState<ZoneMap>(() => {
    if (typeof window === "undefined") return defaultZones;

    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try {
        return JSON.parse(stored) as ZoneMap;
      } catch {
        return defaultZones;
      }
    }
    return defaultZones;
  });

  const [dragState, setDragState] = useState<DragState | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(storageKey, JSON.stringify(zones));
    }
  }, [zones, storageKey]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, zoneLabel: string, mode: DragMode) => {
      if (!enabled) return;

      e.stopPropagation();
      e.preventDefault();

      setDragState({
        zoneLabel,
        mode,
        startX: e.clientX,
        startY: e.clientY,
        startZone: zones[zoneLabel],
      });
    },
    [enabled, zones],
  );

  useEffect(() => {
    if (!dragState) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;

      setZones((prev) => {
        const oldZone = dragState.startZone;
        let newZone: Zone;

        switch (dragState.mode) {
          case "move":
            newZone = {
              ...oldZone,
              x: oldZone.x + dx,
              y: oldZone.y + dy,
            };
            break;

          case "resize-nw":
            newZone = {
              x: oldZone.x + dx,
              y: oldZone.y + dy,
              width: oldZone.width - dx,
              height: oldZone.height - dy,
            };
            break;

          case "resize-ne":
            newZone = {
              ...oldZone,
              y: oldZone.y + dy,
              width: oldZone.width + dx,
              height: oldZone.height - dy,
            };
            break;

          case "resize-sw":
            newZone = {
              ...oldZone,
              x: oldZone.x + dx,
              width: oldZone.width - dx,
              height: oldZone.height + dy,
            };
            break;

          case "resize-se":
            newZone = {
              ...oldZone,
              width: oldZone.width + dx,
              height: oldZone.height + dy,
            };
            break;
        }

        if (newZone.width < 10) newZone.width = 10;
        if (newZone.height < 10) newZone.height = 10;

        return {
          ...prev,
          [dragState.zoneLabel]: newZone,
        };
      });
    };

    const handleMouseUp = () => {
      setDragState(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragState]);

  const ZoneEditor = useCallback(() => {
    if (!enabled) return null;

    return (
      <>
        {Object.entries(zones).map(([label, zone]) => {
          const isActive = dragState?.zoneLabel === label;

          return (
            <div key={label}>
              <div
                onMouseDown={(e) => handleMouseDown(e, label, "move")}
                style={{
                  position: "absolute",
                  left: zone.x,
                  top: zone.y,
                  width: zone.width,
                  height: zone.height,
                  border: isActive
                    ? "2px solid #ff6600"
                    : "2px dashed rgba(255, 100, 0, 0.6)",
                  backgroundColor: isActive
                    ? "rgba(255, 100, 0, 0.15)"
                    : "rgba(255, 100, 0, 0.1)",
                  cursor: "move",
                  pointerEvents: "auto",
                  zIndex: 1000,
                  transition: isActive ? "none" : "all 0.15s ease",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: -20,
                    left: 0,
                    fontSize: 11,
                    fontFamily: "monospace",
                    color: "#ff6600",
                    backgroundColor: "rgba(0, 0, 0, 0.8)",
                    padding: "2px 6px",
                    borderRadius: 3,
                    whiteSpace: "nowrap",
                    pointerEvents: "none",
                  }}
                >
                  {label}
                </div>

                <div
                  style={{
                    position: "absolute",
                    bottom: -20,
                    left: 0,
                    fontSize: 10,
                    fontFamily: "monospace",
                    color: "#999",
                    backgroundColor: "rgba(0, 0, 0, 0.8)",
                    padding: "2px 6px",
                    borderRadius: 3,
                    whiteSpace: "nowrap",
                    pointerEvents: "none",
                  }}
                >
                  {Math.round(zone.x)}, {Math.round(zone.y)} /{" "}
                  {Math.round(zone.width)}×{Math.round(zone.height)}
                </div>

                {["nw", "ne", "sw", "se"].map((corner) => {
                  const positions: Record<string, React.CSSProperties> = {
                    nw: { top: -6, left: -6, cursor: "nw-resize" },
                    ne: { top: -6, right: -6, cursor: "ne-resize" },
                    sw: { bottom: -6, left: -6, cursor: "sw-resize" },
                    se: { bottom: -6, right: -6, cursor: "se-resize" },
                  };

                  return (
                    <div
                      key={corner}
                      onMouseDown={(e) =>
                        handleMouseDown(
                          e,
                          label,
                          `resize-${corner}` as DragMode,
                        )
                      }
                      style={{
                        position: "absolute",
                        ...positions[corner],
                        width: 12,
                        height: 12,
                        backgroundColor: "#ff6600",
                        border: "2px solid white",
                        borderRadius: "50%",
                        pointerEvents: "auto",
                        zIndex: 1001,
                      }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </>
    );
  }, [enabled, zones, dragState, handleMouseDown]);

  const resetZones = useCallback(() => {
    setZones(defaultZones);
  }, [defaultZones]);

  return {
    zones,
    ZoneEditor,
    resetZones,
  };
};
