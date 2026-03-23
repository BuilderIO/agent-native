/**
 * JiraCommentInput - Comment input field with avatar
 */

import React from "react";
import { JiraAvatar } from "./JiraAvatar";

interface JiraCommentInputProps {
  x: number;
  y: number;
  width: number;
  avatarSrc: string;
  isHovered?: boolean;
  hoverProgress?: number;
}

export const JiraCommentInput: React.FC<JiraCommentInputProps> = ({
  x,
  y,
  width,
  avatarSrc,
  isHovered = false,
  hoverProgress = 0,
}) => {
  const scale = 1 + hoverProgress * 0.02;

  return (
    <div
      style={{
        position: "relative",
        width,
        display: "flex",
        alignItems: "flex-start",
        gap: "16px",
      }}
    >
      <JiraAvatar src={avatarSrc} size={48} />

      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {/* Input field */}
        <div
          style={{
            borderRadius: "6px",
            backgroundColor: "rgba(36, 37, 40, 1)",
            border: "1px solid rgba(65, 65, 65, 1)",
            minHeight: 60,
            width: "100%",
            padding: "12px 15px",
            fontSize: 20,
            fontFamily: "Segoe UI, sans-serif",
            fontWeight: 400,
            color: "rgba(150, 153, 158, 1)",
            lineHeight: 1.43,
            cursor: "text",
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            transition: "all 0.15s ease",
            display: "flex",
            alignItems: "flex-start",
          }}
        >
          Add a comment…
        </div>

        {/* Pro tip */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            marginTop: 6,
            fontSize: 18,
            fontFamily: "Segoe UI, sans-serif",
            lineHeight: 1.33,
          }}
        >
          <span style={{ color: "rgba(169, 171, 175, 1)", fontWeight: 700 }}>
            Pro tip:
          </span>
          <span style={{ color: "rgba(150, 153, 158, 1)", fontWeight: 400 }}>
            press
          </span>
          <span
            style={{
              color: "rgba(150, 153, 158, 1)",
              fontWeight: 400,
              fontSize: 16,
              letterSpacing: "0.17px",
              textTransform: "uppercase",
            }}
          >
            M
          </span>
          <span style={{ color: "rgba(150, 153, 158, 1)", fontWeight: 400 }}>
            to comment
          </span>
        </div>
      </div>
    </div>
  );
};
