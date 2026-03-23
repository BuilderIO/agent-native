/**
 * JiraTab - Tab button component for Jira activity section
 */

import React from "react";

interface JiraTabProps {
  label: string;
  isActive?: boolean;
  isHovered?: boolean;
  hoverProgress?: number;
}

export const JiraTab: React.FC<JiraTabProps> = ({
  label,
  isActive = false,
  isHovered = false,
  hoverProgress = 0,
}) => {
  const scale = 1 + hoverProgress * 0.03;

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: isActive ? "8px 22px 8px 18px" : "0",
        backgroundColor: isActive ? "rgba(28, 43, 66, 1)" : "transparent",
        border: isActive ? "1px solid rgba(102, 157, 241, 1)" : "none",
        borderRadius: "3px",
        minHeight: isActive ? 38 : "auto",
        fontSize: 19,
        fontFamily: "Segoe UI, sans-serif",
        fontWeight: 400,
        color: isActive ? "rgba(102, 157, 241, 1)" : "rgba(169, 171, 175, 1)",
        cursor: "pointer",
        transform: `scale(${scale})`,
        transition: "all 0.15s ease",
      }}
    >
      {label}
    </div>
  );
};
