import { Camera, Move, ZoomIn, RotateCw } from "lucide-react";

export interface UICameraToolbarProps {
  x: number;
  y: number;
  activeTool?: "pan" | "zoom" | "tilt" | null;
}

export function UICameraToolbar({
  x,
  y,
  activeTool = null,
}: UICameraToolbarProps) {
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
      }}
    >
      {/* Toolbar container */}
      <div className="flex items-center gap-3 px-4 py-2 bg-card/80 backdrop-blur-sm border border-border rounded-lg">
        {/* Camera icon */}
        <Camera className="w-4 h-4 text-blue-400" />

        {/* Divider */}
        <div className="w-px h-5 bg-border" />

        {/* Pan tool */}
        <button
          className={`px-3 py-1.5 text-sm rounded transition-all flex items-center gap-2 ${
            activeTool === "pan"
              ? "bg-blue-500 text-white"
              : "text-foreground/70 hover:bg-secondary/50"
          }`}
        >
          <Move className="w-3.5 h-3.5" />
          Pan
        </button>

        {/* Zoom tool */}
        <button
          className={`px-3 py-1.5 text-sm rounded transition-all flex items-center gap-2 ${
            activeTool === "zoom"
              ? "bg-blue-500 text-white"
              : "text-foreground/70 hover:bg-secondary/50"
          }`}
        >
          <ZoomIn className="w-3.5 h-3.5" />
          Zoom
        </button>

        {/* Tilt tool */}
        <button
          className={`px-3 py-1.5 text-sm rounded transition-all flex items-center gap-2 ${
            activeTool === "tilt"
              ? "bg-blue-500 text-white"
              : "text-foreground/70 hover:bg-secondary/50"
          }`}
        >
          <RotateCw className="w-3.5 h-3.5" />
          Tilt
        </button>

        {/* Divider */}
        <div className="w-px h-5 bg-border ml-1" />

        {/* Add Keyframe button */}
        <button className="px-3 py-1.5 text-sm rounded border border-blue-500/50 text-blue-400 hover:bg-blue-500/10 transition-all font-medium">
          + Add Keyframe
        </button>
      </div>
    </div>
  );
}
