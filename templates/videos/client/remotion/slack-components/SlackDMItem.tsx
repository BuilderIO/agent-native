/**
 * SlackDMItem - Direct message list item with avatar
 */
import React from "react";

interface SlackDMItemProps {
  avatar: string;
  name: string;
  isActive?: boolean;
  hoverProgress?: number;
  clickProgress?: number;
}

export const SlackDMItem: React.FC<SlackDMItemProps> = ({
  avatar,
  name,
  isActive = false,
  hoverProgress = 0,
  clickProgress = 0,
}) => {
  const bgOpacity = isActive ? 0.15 : hoverProgress * 0.1;
  const scale = 1 + (hoverProgress * 0.02) - (clickProgress * 0.01);

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
          padding: "5px 17px",
        }}
      >
        <img
          src={avatar}
          alt=""
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            objectFit: "cover",
          }}
        />
        <div
          style={{
            color: "rgba(227, 206, 235, 1)",
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
