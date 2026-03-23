/**
 * SlackTopHeader - Top navigation bar with logo, search, and icons
 */
import React from "react";
import { SlackSearchInput } from "./SlackSearchInput";

interface SlackTopHeaderProps {
  width: number;
  searchHoverProgress?: number;
}

export const SlackTopHeader: React.FC<SlackTopHeaderProps> = ({
  width,
  searchHoverProgress = 0,
}) => {
  return (
    <div
      style={{
        width,
        height: 55,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 26px",
        background: "transparent",
      }}
    >
      {/* Left section - Invisible spacer (balances right section) */}
      <div style={{ display: "flex", alignItems: "center" }}>
        {/* Invisible divider - spacing trick! */}
        <div style={{ width: 1, height: 32, background: "transparent" }} />
      </div>

      {/* Center section - Navigation icons + Search bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 15 }}>
        {/* Navigation Icons */}
        <img
          src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/6fd0bdef46148e63f0f1f025a361378b1a87b7b2"
          alt=""
          style={{ width: 27, height: 27 }}
        />
        <img
          src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/3bd2319842811e54679d6229342b09d313193e76"
          alt=""
          style={{ width: 27, height: 27 }}
        />
        <img
          src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/08a056ed30842fefa66de275a2b8ad1d16677b86"
          alt=""
          style={{ width: 27, height: 27 }}
        />

        {/* Search */}
        <SlackSearchInput width={660} hoverProgress={searchHoverProgress} />
      </div>

      {/* Right section - Help/Settings Icons */}
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <img
          src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/ee3b8acb91319e0984eba5ef09d03b2a3bdba064"
          alt=""
          style={{ width: 27, height: 27 }}
        />
        <img
          src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/7f02b79f546aa2edefb96623732bfe1ab81e6681"
          alt=""
          style={{ width: 28, height: 28 }}
        />
      </div>
    </div>
  );
};
