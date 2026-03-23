/**
 * SlackChannelItem - Channel list item for middle sidebar
 */
import React from "react";

interface SlackChannelItemProps {
  icon: string;
  name: string;
  isActive?: boolean;
  hoverProgress?: number;
  clickProgress?: number;
}

export const SlackChannelItem: React.FC<SlackChannelItemProps> = ({
  icon,
  name,
  isActive = false,
  hoverProgress = 0,
  clickProgress = 0,
}) => {
  const bgOpacity = isActive ? 0.15 : hoverProgress * 0.1;
  const scale = 1 + hoverProgress * 0.02 - clickProgress * 0.01;

  return (
    <div
      style={{
        borderRadius: 6,
        background: `rgba(255, 255, 255, ${bgOpacity})`,
        transform: `scale(${scale})`,
        transformOrigin: "left center",
        transition: "background-color 0.2s",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 11,
          padding: "6px 17px",
        }}
      >
        <img src={icon} alt="" style={{ width: 21, height: 21 }} />
        <div
          style={{
            color: isActive
              ? "rgba(248, 248, 248, 1)"
              : "rgba(248, 248, 248, 1)",
            fontSize: 19,
            fontFamily: "Inter, -apple-system, Roboto, Helvetica, sans-serif",
            fontWeight: 400,
            lineHeight: "38px",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </div>
      </div>
    </div>
  );
};
