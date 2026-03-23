/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BRANCH CARD ATOM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Individual branch card for the Kanban view.
 * Shows branch name, project name, status badge, and avatar.
 *
 * Features:
 * - Status badge with appropriate colors
 * - Avatar circle with letter
 * - Hover state with border
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React from "react";

export type BranchCardProps = {
  branchName: string;
  projectName: string;
  status?: "IN PROGRESS" | "IN REVIEW" | "PR OPEN" | "MERGED" | null;
  avatarLetter: string;
  avatarColor: string;
  hasCheckIcon?: boolean;
  isHighlighted?: boolean;
};

export const BranchCard: React.FC<BranchCardProps> = ({
  branchName,
  projectName,
  status,
  avatarLetter,
  avatarColor,
  hasCheckIcon = false,
  isHighlighted = false,
}) => {
  // Status badge colors
  const getStatusStyle = () => {
    switch (status) {
      case "IN PROGRESS":
        return {
          backgroundColor: "rgba(7, 29, 58, 1)",
          color: "rgba(72, 161, 255, 1)",
        };
      case "IN REVIEW":
        return {
          backgroundColor: "rgba(58, 33, 7, 1)",
          color: "rgba(255, 188, 72, 1)",
        };
      case "PR OPEN":
        return {
          backgroundColor: "rgba(7, 29, 58, 1)",
          color: "rgba(72, 161, 255, 1)",
        };
      case "MERGED":
        return {
          backgroundColor: "rgba(0, 145, 0, 0.2)",
          color: "rgba(0, 145, 0, 1)",
        };
      default:
        return null;
    }
  };

  const statusStyle = getStatusStyle();

  return (
    <div
      style={{
        borderRadius: 14,
        backgroundColor: "#191919",
        borderColor: isHighlighted ? "#47a0fe" : "#393939",
        borderStyle: "solid",
        borderWidth: 2,
        boxShadow: isHighlighted
          ? "0px 0px 16px rgba(72, 161, 255, 0.2)"
          : "none",
        padding: "22px",
        display: "flex",
        flexDirection: "column",
        cursor: "pointer",
        transition: "all 0.2s",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {/* Branch name and project */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div
            style={{
              display: "flex",
              alignItems: "start",
              justifyContent: "space-between",
              gap: 40,
            }}
          >
            <div
              style={{
                fontSize: 26,
                color: "#ffffff",
                fontFamily: "Inter, sans-serif",
                fontWeight: 500,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {branchName}
            </div>
            {hasCheckIcon && (
              <div
                style={{
                  borderRadius: "50%",
                  width: 34,
                  height: 34,
                  flexShrink: 0,
                }}
              />
            )}
          </div>
          <div
            style={{
              fontSize: 20,
              color: "#9c9c9c",
              fontFamily: "Inter, sans-serif",
              fontWeight: 400,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {projectName}
          </div>
        </div>

        {/* Status badge and avatar */}
        <div
          style={{
            display: "flex",
            alignItems: "start",
            justifyContent: "space-between",
            gap: 40,
          }}
        >
          {statusStyle && (
            <div
              style={{
                borderRadius: 10,
                backgroundColor: statusStyle.backgroundColor,
                padding: "6px 12px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  fontSize: 22,
                  color: statusStyle.color,
                  fontFamily: "Inter, sans-serif",
                  fontWeight: 600,
                  letterSpacing: "0.8px",
                  lineHeight: 1.45,
                }}
              >
                {status}
              </div>
            </div>
          )}
          {!statusStyle && <div style={{ flex: 1 }} />}
          <div
            style={{
              borderRadius: "50%",
              backgroundColor: avatarColor,
              width: 36,
              height: 36,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <div
              style={{
                fontSize: 20,
                color: "#ffffff",
                fontFamily: "Inter, sans-serif",
                fontWeight: 700,
                textAlign: "center",
              }}
            >
              {avatarLetter}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
