/**
 * JiraTaskHeader - Task title and star button
 */

import React from "react";
import { JiraBreadcrumb } from "./JiraBreadcrumb";

interface JiraTaskHeaderProps {
  x: number;
  y: number;
  width: number;
  title: string;
  starButtonHovered?: boolean;
  starButtonProgress?: number;
}

export const JiraTaskHeader: React.FC<JiraTaskHeaderProps> = ({
  x,
  y,
  width,
  title,
  starButtonHovered = false,
  starButtonProgress = 0,
}) => {
  const scale = 1 + starButtonProgress * 0.1;

  return (
    <div
      style={{
        position: "relative",
        width,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Breadcrumb */}
      <JiraBreadcrumb x={0} y={0} />

      {/* Title and + icon on same line */}
      <div
        style={{
          marginTop: 12,
          display: "flex",
          alignItems: "center",
          gap: "16px",
        }}
      >
        <div
          style={{
            color: "rgba(255, 255, 255, 1)",
            fontSize: 36,
            fontFamily: "Segoe UI, sans-serif",
            fontWeight: 700,
            lineHeight: 1.17,
            flex: 1,
          }}
        >
          {title}
        </div>

        {/* Star button (+ icon) */}
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: "5px",
            border: "1px solid rgba(58, 59, 61, 1)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: starButtonHovered
              ? "rgba(58, 59, 61, 1)"
              : "transparent",
            transform: `scale(${scale})`,
            transition: "all 0.15s ease",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/dd30d739f4e8b1e35acc6898dcf1c554d4fda110?placeholderIfAbsent=true"
            alt="Star"
            style={{ width: 20, height: 20, objectFit: "contain" }}
          />
        </div>
      </div>
    </div>
  );
};
