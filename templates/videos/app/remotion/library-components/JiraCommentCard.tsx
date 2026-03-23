/**
 * JiraCommentCard - Comment card component for activity section
 */

import React from "react";
import { JiraAvatar } from "./JiraAvatar";

interface JiraCommentCardProps {
  avatarSrc: string;
  username: string;
  timestamp: string;
  content: React.ReactNode;
  x: number;
  y: number;
  width: number;
}

export const JiraCommentCard: React.FC<JiraCommentCardProps> = ({
  avatarSrc,
  username,
  timestamp,
  content,
  x,
  y,
  width,
}) => {
  return (
    <div
      style={{
        position: "relative",
        width,
        display: "flex",
        flexDirection: "column",
        fontFamily: "Segoe UI, sans-serif",
      }}
    >
      {/* Header with avatar and username */}
      <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
        <JiraAvatar src={avatarSrc} size={48} />
        <div style={{ display: "flex", flexDirection: "column", width: 180 }}>
          <div
            style={{
              color: "rgba(169, 171, 175, 1)",
              fontSize: 28,
              fontWeight: 700,
              lineHeight: 1.2,
            }}
          >
            {username}
          </div>
          <div
            style={{
              color: "rgba(150, 153, 158, 1)",
              fontSize: 18,
              fontWeight: 400,
              lineHeight: 1.33,
            }}
          >
            {timestamp}
          </div>
        </div>
      </div>

      {/* Content */}
      <div
        style={{
          marginTop: 14,
          paddingLeft: 62,
          fontSize: 18,
          color: "rgba(236, 236, 236, 1)",
          fontWeight: 400,
          lineHeight: "30px",
        }}
      >
        {content}
      </div>
    </div>
  );
};
