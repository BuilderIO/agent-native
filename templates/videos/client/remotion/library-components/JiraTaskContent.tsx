/**
 * JiraTaskContent - Left main content area with task details, key details, and activity
 */

import React from "react";
import { JiraTaskHeader } from "./JiraTaskHeader";
import { JiraKeyDetails } from "./JiraKeyDetails";

interface JiraTaskContentProps {
  x: number;
  y: number;
  width: number;
  height: number;
  taskTitle: string;
  taskDescription: string;
  starButtonHovered?: boolean;
  starButtonProgress?: number;
  children?: React.ReactNode;
}

export const JiraTaskContent: React.FC<JiraTaskContentProps> = ({
  x,
  y,
  width,
  height,
  taskTitle,
  taskDescription,
  starButtonHovered = false,
  starButtonProgress = 0,
  children,
}) => {
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width,
        height,
        backgroundColor: "rgba(31, 31, 33, 1)",
        border: "1px solid rgba(42, 42, 42, 1)",
        padding: "34px 40px 53px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Task Header */}
      <JiraTaskHeader
        x={0}
        y={0}
        width={width - 80}
        title={taskTitle}
        starButtonHovered={starButtonHovered}
        starButtonProgress={starButtonProgress}
      />

      {/* Key Details */}
      <JiraKeyDetails
        x={0}
        y={120}
        width={width - 80}
        description={taskDescription}
      />

      {/* Children (Activity section, etc.) */}
      <div style={{ marginTop: 43, width: "100%" }}>
        {children}
      </div>
    </div>
  );
};
