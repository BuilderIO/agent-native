/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BRANCHES KANBAN VIEW ORGANISM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The main branches Kanban board view with tabs and columns.
 *
 * Features:
 * - Tab navigation (Projects, Branches, Pull Requests) with Branches active
 * - View toggle, sort, and search controls
 * - Kanban columns (In Progress, In Review, PR Open, Merged, Archived)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React from "react";
import { BranchesKanbanColumn } from "./BranchesKanbanColumn";
import type { AnimationTrack } from "@/types";

export type BranchesKanbanViewProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  tracks?: AnimationTrack[];
};

export const BranchesKanbanView: React.FC<BranchesKanbanViewProps> = (
  props,
) => {
  const { x = 0, y = 0, width = 1920 } = props;

  const useAbsolutePosition = x !== 0 || y !== 0;

  // Column data
  const columns = [
    {
      title: "In Progress",
      cards: [
        {
          branchName: "claude-code-for-designers",
          projectName: "content-workspace",
          status: "IN PROGRESS" as const,
          avatarLetter: "A",
          avatarColor: "#9747ff",
          isHighlighted: true,
        },
        {
          branchName: "jest-testing-fix",
          projectName: "enterprise-dashboard",
          status: null,
          avatarLetter: "C",
          avatarColor: "#245f24",
        },
      ],
    },
    {
      title: "In Review",
      cards: [
        {
          branchName: "stop-alert-spam",
          projectName: "sales-dash",
          status: "IN REVIEW" as const,
          avatarLetter: "G",
          avatarColor: "#902d88",
        },
        {
          branchName: "add-regional-zones",
          projectName: "map-tool",
          status: "IN REVIEW" as const,
          avatarLetter: "H",
          avatarColor: "#2d6890",
        },
        {
          branchName: "pipeline-fix",
          projectName: "analytics-dash",
          status: "IN REVIEW" as const,
          avatarLetter: "C",
          avatarColor: "#902d2d",
        },
      ],
    },
    {
      title: "PR Open",
      cards: [
        {
          branchName: "stop-alert-spam",
          projectName: "sales-dash",
          status: "PR OPEN" as const,
          avatarLetter: "G",
          avatarColor: "#902d88",
        },
        {
          branchName: "block-user-requests",
          projectName: "support-dash",
          status: "PR OPEN" as const,
          avatarLetter: "W",
          avatarColor: "#2d9086",
        },
        {
          branchName: "disable-automated-messages",
          projectName: "marketing-dash",
          status: "PR OPEN" as const,
          avatarLetter: "J",
          avatarColor: "#2d6890",
        },
        {
          branchName: "manage-notifications-settings",
          projectName: "admin-dash",
          status: "PR OPEN" as const,
          avatarLetter: "Q",
          avatarColor: "#622d90",
        },
      ],
    },
    {
      title: "Merged",
      cards: [
        {
          branchName: "manage-notifications-settings",
          projectName: "admin-dash",
          status: "MERGED" as const,
          avatarLetter: "Q",
          avatarColor: "#622d90",
        },
        {
          branchName: "update-user-permissions",
          projectName: "admin-dash",
          status: "MERGED" as const,
          avatarLetter: "R",
          avatarColor: "#245f24",
        },
        {
          branchName: "view-audit-logs",
          projectName: "admin-dash",
          status: "MERGED" as const,
          avatarLetter: "S",
          avatarColor: "#90512d",
        },
        {
          branchName: "configure-security-options",
          projectName: "admin-dash",
          status: "MERGED" as const,
          avatarLetter: "T",
          avatarColor: "#902d5e",
        },
        {
          branchName: "generate-reports",
          projectName: "admin-dash",
          status: "MERGED" as const,
          avatarLetter: "U",
          avatarColor: "#2d907c",
        },
      ],
    },
    {
      title: "Archived",
      cards: [
        {
          branchName: "manage-notifications-settings",
          projectName: "admin-dash",
          status: null,
          avatarLetter: "L",
          avatarColor: "#622d90",
        },
        {
          branchName: "update-user-permissions",
          projectName: "user-settings",
          status: null,
          avatarLetter: "T",
          avatarColor: "#902d5e",
        },
        {
          branchName: "view-activity-logs",
          projectName: "admin-dash",
          status: null,
          avatarLetter: "R",
          avatarColor: "#245f24",
        },
        {
          branchName: "configure-api-keys",
          projectName: "api-settings",
          status: null,
          avatarLetter: "S",
          avatarColor: "#90512d",
        },
        {
          branchName: "generate-reports",
          projectName: "reporting-tools",
          status: null,
          avatarLetter: "E",
          avatarColor: "#2d9086",
        },
      ],
    },
  ];

  return (
    <div
      style={{
        position: useAbsolutePosition ? "absolute" : "relative",
        left: useAbsolutePosition ? x : undefined,
        top: useAbsolutePosition ? y : undefined,
        width: width,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Top Bar with Tabs and Controls */}
      <div
        style={{
          borderRadius: "0px 0px 0px 0px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "end",
            flexWrap: "wrap",
            gap: 24,
          }}
        >
          {/* Tabs */}
          <div
            style={{
              display: "flex",
              alignItems: "start",
              gap: 23,
              fontSize: 17,
              fontFamily: "Inter, sans-serif",
              color: "#a4a4a4",
              fontWeight: 500,
              lineHeight: 1.5,
            }}
          >
            <div style={{ cursor: "pointer" }}>Projects</div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                color: "#48a1ff",
              }}
            >
              <div style={{ cursor: "pointer" }}>Branches</div>
              <div
                style={{
                  backgroundColor: "#48a1ff",
                  height: 2,
                  marginTop: 7,
                }}
              />
            </div>
            <div style={{ cursor: "pointer" }}>Pull Requests</div>
          </div>

          {/* Controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 17 }}>
            {/* View Toggle */}
            <div
              style={{
                borderRadius: 4,
                backgroundColor: "#2a2a2a",
                borderColor: "#393939",
                borderStyle: "solid",
                borderWidth: 1,
                display: "flex",
                padding: 5,
                gap: 7,
              }}
            >
              <div
                style={{
                  borderRadius: 4,
                  width: 26,
                  height: 29,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                }}
              >
                <img
                  src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/dce1312a170cd749ae32b8780cf13bd1e4cd69bc?placeholderIfAbsent=true"
                  alt=""
                  style={{ width: 19, aspectRatio: 1, objectFit: "contain" }}
                />
              </div>
              <div
                style={{
                  borderRadius: 3,
                  backgroundColor: "#191919",
                  width: 28,
                  height: 29,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                }}
              >
                <img
                  src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/41709b7ff287ddf7022cbd04c35c1af5935280d0?placeholderIfAbsent=true"
                  alt=""
                  style={{ width: 19, aspectRatio: 1, objectFit: "contain" }}
                />
              </div>
            </div>

            {/* Sort Button */}
            <div
              style={{
                borderRadius: 4,
                backgroundColor: "#2a2a2a",
                borderColor: "#393939",
                borderStyle: "solid",
                borderWidth: 1,
                width: 36,
                height: 36,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              <img
                src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/08d2c9d6d7d0236df1549bf6d99c8d7f40f844d1?placeholderIfAbsent=true"
                alt=""
                style={{ width: 18, aspectRatio: 1, objectFit: "contain" }}
              />
            </div>

            {/* Search Input */}
            <div
              style={{
                borderRadius: 6,
                backgroundColor: "#2a2a2a",
                borderColor: "#393939",
                borderStyle: "solid",
                borderWidth: 1,
                height: 41,
                padding: "10px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontFamily: "Inter, sans-serif",
                fontWeight: 400,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 17,
                  color: "#999999",
                }}
              >
                <img
                  src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/57201b4b4a2bc44d024176c9c4496bf901ea3d52?placeholderIfAbsent=true"
                  alt=""
                  style={{ width: 20, aspectRatio: 1, objectFit: "contain" }}
                />
                <span>Search branches...</span>
              </div>
              <div
                style={{
                  borderRadius: 4,
                  backgroundColor: "#292929",
                  borderColor: "#373737",
                  borderStyle: "solid",
                  borderWidth: 1,
                  width: 21,
                  height: 20,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  color: "#8a8a8a",
                }}
              >
                /
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Kanban Board */}
      <div
        style={{
          display: "flex",
          marginTop: 42,
          gap: 22,
          alignItems: "start",
        }}
      >
        {columns.map((column, index) => (
          <BranchesKanbanColumn key={index} {...column} />
        ))}
      </div>
    </div>
  );
};
