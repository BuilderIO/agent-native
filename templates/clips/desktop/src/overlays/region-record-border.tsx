import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

interface BorderRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * The live recording region is handed to this overlay window as a normalized
 * rect in the URL query (`?region=x,y,width,height`) so it never has to wait
 * on a Tauri event (which could race the webview load). All four values are
 * fractions [0,1] of the recording monitor — the same space the region-capture
 * selector emitted them in.
 */
function parseRect(search: string): BorderRect | null {
  const raw = new URLSearchParams(search).get("region");
  if (!raw) return null;
  const parts = raw.split(",").map((value) => Number.parseFloat(value));
  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) {
    return null;
  }
  const [x, y, width, height] = parts;
  if (width <= 0 || height <= 0) return null;
  return {
    x: clamp01(x),
    y: clamp01(y),
    width: clamp01(width),
    height: clamp01(height),
  };
}

/**
 * A thin frame painted around the screen region currently being recorded. The
 * window itself is full-screen, click-through, and capture-excluded (see
 * `show_region_record_border` on the Rust side). The frame is drawn entirely
 * OUTWARD via an outset box-shadow with no fill, so its pixels sit just outside
 * the captured rect and never leak into the recording even on the macOS 15.4+
 * builds where `NSWindowSharingNone` is occasionally bypassed.
 */
export function RegionRecordBorder() {
  const [rect] = useState<BorderRect | null>(() =>
    typeof window === "undefined" ? null : parseRect(window.location.search),
  );

  useEffect(() => {
    if (rect) return;
    // No usable region — close the overlay so an empty window never lingers.
    getCurrentWindow()
      .close()
      .catch(() => {});
  }, [rect]);

  if (!rect) return null;

  return (
    <div className="region-record-border-layer" aria-hidden>
      <div
        className="region-record-border-frame"
        style={{
          left: `${rect.x * 100}%`,
          top: `${rect.y * 100}%`,
          width: `${rect.width * 100}%`,
          height: `${rect.height * 100}%`,
        }}
      />
    </div>
  );
}
