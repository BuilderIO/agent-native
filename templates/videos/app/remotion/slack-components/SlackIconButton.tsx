/**
 * SlackIconButton - Atomic component for icon-based buttons in Slack UI
 */
import React from "react";

interface SlackIconButtonProps {
  icon: string;
  size?: number;
  isActive?: boolean;
  hoverProgress?: number;
  clickProgress?: number;
}

export const SlackIconButton: React.FC<SlackIconButtonProps> = ({
  icon,
  size = 24,
  isActive = false,
  hoverProgress = 0,
  clickProgress = 0,
}) => {
  const scale = 1 + hoverProgress * 0.1 - clickProgress * 0.05;
  const opacity = isActive ? 1 : 0.7 + hoverProgress * 0.3;

  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transform: `scale(${scale})`,
        opacity,
        transition: "opacity 0.2s",
      }}
    >
      <img
        src={icon}
        alt=""
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
        }}
      />
    </div>
  );
};
