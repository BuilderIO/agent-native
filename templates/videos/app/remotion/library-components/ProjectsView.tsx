/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PROJECTS VIEW ORGANISM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The main projects list view with tabs, controls, and project cards grid.
 * Contains the navigation tabs and search functionality.
 *
 * Features:
 * - Tab navigation (Projects, Branches, Pull Requests)
 * - View toggle (grid/list)
 * - Sort button
 * - Search input with keyboard shortcut
 * - Grid of project cards
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React from "react";
import { createInteractiveComposition } from "@/remotion/hooks/createInteractiveComposition";
import type { AnimationTrack } from "@/types";

export type ProjectsViewProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  activeTab?: "projects" | "branches" | "pullRequests";
  tracks?: AnimationTrack[];
};

export const ProjectsView: React.FC<ProjectsViewProps> = (props) => {
  const {
    x = 0,
    y = 0,
    width = 1920,
    height = 1080,
    activeTab = "projects",
    tracks = [],
  } = props;

  // Use absolute positioning only when x or y are non-zero (standalone mode)
  // Otherwise use relative positioning for composition
  const useAbsolutePosition = x !== 0 || y !== 0;

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
      {/* Top Bar */}
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
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              color: activeTab === "projects" ? "#48a1ff" : "#a4a4a4",
            }}
          >
            <div style={{ cursor: "pointer" }}>Projects</div>
            {activeTab === "projects" && (
              <div
                style={{
                  backgroundColor: "#48a1ff",
                  height: 1,
                  marginTop: 7,
                }}
              />
            )}
          </div>
          <div style={{ cursor: "pointer" }}>Branches</div>
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
              padding: 4,
              gap: 7,
            }}
          >
            <div
              style={{
                borderRadius: 4,
                backgroundColor: "#191919",
                width: 31,
                height: 31,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              <img
                src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/c300a6ed0ed6d83e00305df9e409ae11b1b644c3?placeholderIfAbsent=true"
                alt=""
                style={{ width: 19, aspectRatio: 1, objectFit: "contain" }}
              />
            </div>
            <img
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/17a4002ff730ead5b53d195a0a039a6923058dd4?placeholderIfAbsent=true"
              alt=""
              style={{
                width: 16,
                aspectRatio: 1,
                objectFit: "contain",
                cursor: "pointer",
              }}
            />
          </div>

          {/* Sort Button */}
          <div
            style={{
              borderRadius: 4,
              backgroundColor: "#2a2a2a",
              borderColor: "#393939",
              borderStyle: "solid",
              borderWidth: 1,
              width: 41,
              height: 41,
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
              width: 310,
              height: 41,
              display: "flex",
              padding: 10,
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
              <span>Search projects...</span>
            </div>
            <div
              style={{
                borderRadius: 4,
                backgroundColor: "#292929",
                borderColor: "#373737",
                borderStyle: "solid",
                borderWidth: 1,
                width: 22,
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
  );
};

// Preview composition
export const ProjectsViewPreview = createInteractiveComposition({
  component: ProjectsView,
  width: 1920,
  height: 1080,
  durationInFrames: 150,
  fps: 30,
  tracks: [],
  defaultProps: {
    x: 69,
    y: 236,
  },
});
