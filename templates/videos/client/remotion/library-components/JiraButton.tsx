/**
 * JiraButton - Reusable button component for Jira interface
 */

import React from "react";

interface JiraButtonProps {
  x: number;
  y: number;
  width?: number;
  height?: number;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "icon";
  isHovered?: boolean;
  hoverProgress?: number;
  onClick?: () => void;
}

export const JiraButton: React.FC<JiraButtonProps> = ({
  x,
  y,
  width,
  height,
  children,
  variant = "secondary",
  isHovered = false,
  hoverProgress = 0,
}) => {
  const getStyles = () => {
    if (variant === "primary") {
      const scale = 1 + hoverProgress * 0.05;
      return {
        backgroundColor: "rgba(21, 88, 188, 1)",
        color: "rgba(255, 255, 255, 1)",
        borderRadius: "5px",
        padding: "12px 18px",
        fontSize: 20,
        fontWeight: 600,
        transform: `scale(${scale})`,
      };
    } else if (variant === "icon") {
      const scale = 1 + hoverProgress * 0.1;
      return {
        backgroundColor: isHovered ? "rgba(58, 59, 61, 1)" : "transparent",
        borderRadius: "5px",
        border: "1px solid rgba(58, 59, 61, 1)",
        padding: "12px 14px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transform: `scale(${scale})`,
      };
    } else {
      const scale = 1 + hoverProgress * 0.05;
      return {
        backgroundColor: isHovered ? "rgba(58, 59, 61, 1)" : "transparent",
        color: "rgba(214, 214, 214, 1)",
        borderRadius: "5px",
        border: "1px solid rgba(58, 59, 61, 1)",
        padding: "12px 14px",
        fontSize: 20,
        fontWeight: 600,
        transform: `scale(${scale})`,
      };
    }
  };

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width,
        height,
        fontFamily: "Segoe UI, sans-serif",
        cursor: "pointer",
        transition: "all 0.2s ease",
        ...getStyles(),
      }}
    >
      {children}
    </div>
  );
};
