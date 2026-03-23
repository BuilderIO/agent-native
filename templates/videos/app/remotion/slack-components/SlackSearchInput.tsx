/**
 * SlackSearchInput - Slack-style search bar component
 */
import React from "react";

interface SlackSearchInputProps {
  width: number;
  isFocused?: boolean;
  hoverProgress?: number;
}

export const SlackSearchInput: React.FC<SlackSearchInputProps> = ({
  width,
  isFocused = false,
  hoverProgress = 0,
}) => {
  const borderOpacity = 0.25 + hoverProgress * 0.15;

  return (
    <div
      style={{
        width,
        height: 40,
        borderRadius: 8,
        background: "rgba(239, 225, 245, 0.25)",
        border: `1px solid rgba(255, 255, 255, ${borderOpacity})`,
        display: "flex",
        alignItems: "center",
        paddingLeft: 16,
        paddingRight: 16,
        gap: 12,
        transition: "border-color 0.2s",
      }}
    >
      <img
        src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/3a1b50059ad0567c6aec4e65ece74fbe94c525ac"
        alt=""
        style={{ width: 20, height: 20 }}
      />
      <div
        style={{
          color: "rgba(248, 248, 248, 1)",
          fontSize: 17,
          fontFamily: "Inter, -apple-system, Roboto, Helvetica, sans-serif",
        }}
      >
        Search ACME
      </div>
    </div>
  );
};
