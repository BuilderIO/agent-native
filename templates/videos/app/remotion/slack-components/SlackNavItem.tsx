/**
 * SlackNavItem - Navigation item for left sidebar (Home, DMs, Activity, etc.)
 */
import React from "react";

interface SlackNavItemProps {
  icon: string;
  label: string;
  isActive?: boolean;
  hoverProgress?: number;
  clickProgress?: number;
}

export const SlackNavItem: React.FC<SlackNavItemProps> = ({
  icon,
  label,
  isActive = false,
  hoverProgress = 0,
  clickProgress = 0,
}) => {
  const scale = 1 + hoverProgress * 0.05 - clickProgress * 0.03;
  const bgOpacity = hoverProgress * 0.1;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 14,
        padding: "0 8px",
        transform: `scale(${scale})`,
        transition: "transform 0.2s",
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 11,
          background: isActive
            ? "rgba(255, 255, 255, 0.15)"
            : `rgba(255, 255, 255, ${bgOpacity})`,
          border: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <img src={icon} alt={label} style={{ width: 24, height: 24 }} />
      </div>
      <div
        style={{
          color: "rgba(248, 248, 248, 1)",
          fontSize: 15,
          fontFamily: "Inter, -apple-system, Roboto, Helvetica, sans-serif",
          fontWeight: 600,
          textAlign: "center",
        }}
      >
        {label}
      </div>
    </div>
  );
};
