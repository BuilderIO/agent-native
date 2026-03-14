import { AbsoluteFill } from "remotion";
import { Menu } from "lucide-react";
import type { InteractiveComponentState } from "../hooks/useInteractiveComponent";

export interface UIHeaderProps {
  x: number;
  y: number;
  width: number;
  height: number;
  sidebarToggle?: InteractiveComponentState;
}

export function UIHeader({ x, y, width, height }: UIHeaderProps) {
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width,
        height,
      }}
    >
      {/* Header container */}
      <div
        style={{
          height: "100%",
          backgroundColor: "rgba(23, 23, 23, 0.8)",
          backdropFilter: "blur(24px)",
          borderBottom: "1px solid rgba(64, 64, 64, 0.5)",
          display: "flex",
          alignItems: "center",
          padding: "0 16px",
        }}
      >
        {/* Left: Sidebar toggle */}
        <button
          style={{
            width: 32,
            height: 32,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "4px",
            backgroundColor: "transparent",
            border: "none",
            cursor: "pointer",
          }}
        >
          <Menu
            style={{ width: 20, height: 20, color: "rgba(255, 255, 255, 0.6)" }}
          />
        </button>

        {/* Center: Title with gradient */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            fontSize: "20px",
            fontWeight: "bold",
            background:
              "linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #ec4899 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          Video Studio
        </div>

        {/* Right: User menu (simple circle) */}
        <div
          style={{
            marginLeft: "auto",
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: "linear-gradient(to bottom right, #6366f1, #ec4899)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "10px",
            fontWeight: "500",
            color: "white",
          }}
        >
          U
        </div>
      </div>
    </div>
  );
}
