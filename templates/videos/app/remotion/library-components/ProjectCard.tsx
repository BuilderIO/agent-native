/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PROJECT CARD MOLECULE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A card displaying project information including preview, branches, and actions.
 * Used within the Projects View organism.
 *
 * Features:
 * - Project preview/thumbnail
 * - Project name and last edited time
 * - Branches section with "New Branch" button
 * - Branch list items
 * - Show more / View all branches links
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React from "react";
import { createInteractiveComposition } from "@/remotion/hooks/createInteractiveComposition";
import type { AnimationTrack } from "@/types";

export type ProjectCardProps = {
  x?: number;
  y?: number;
  width?: number;
  projectName?: string;
  lastEdited?: string;
  previewImage?: string;
  avatarImage?: string;
  branches?: Array<{
    name: string;
    timeAgo: string;
    avatarImage: string;
    statusIcon: string;
  }>;
  tracks?: AnimationTrack[];
};

export const ProjectCard: React.FC<ProjectCardProps> = (props) => {
  const {
    x = 0,
    y = 0,
    width = 325,
    projectName = "sales-dash",
    lastEdited = "Edited 3hr ago",
    previewImage = "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/47e7939cce14e436f6a642c4d9bc854b51921c30?placeholderIfAbsent=true",
    avatarImage = "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/e00c7e415a248072007c7a09a2bc933347e5f3c7?placeholderIfAbsent=true",
    branches = [
      {
        name: "add-top-sources",
        timeAgo: "3 hr ago",
        avatarImage:
          "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/2b536ddd59099ee76d316a7dac1a2e30add8da48?placeholderIfAbsent=true",
        statusIcon:
          "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/27e05e8e75ad8b8ffb335fdc8efc1248596e26aa?placeholderIfAbsent=true",
      },
      {
        name: "register-components",
        timeAgo: "5 hr ago",
        avatarImage:
          "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/9abb9bfd27065db5f2e84a5000a196098c2adb20?placeholderIfAbsent=true",
        statusIcon:
          "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/0fb587208661e0859816cbdf05a8517bfceca602?placeholderIfAbsent=true",
      },
    ],
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
        borderRadius: 14,
        backgroundColor: "#191919",
        borderColor: "#393939",
        borderStyle: "solid",
        borderWidth: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        paddingBottom: 18,
      }}
    >
      {/* Preview Image Section */}
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: 1.774,
          borderRadius: "5px 5px 0px 0px",
        }}
      >
        <img
          src={previewImage}
          alt=""
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "center",
          }}
        />
        {/* Overlay Icons */}
        <div
          style={{
            position: "absolute",
            top: 10,
            left: 10,
            right: 10,
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              borderRadius: 7,
              backgroundColor: "#191919",
              borderColor: "#333333",
              borderStyle: "solid",
              borderWidth: 1,
              width: 47,
              height: 47,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <img
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/32ab90eb50fbd5877cfdf54431307bed3b5b6508?placeholderIfAbsent=true"
              alt=""
              style={{ width: 14, aspectRatio: 0.92, objectFit: "contain" }}
            />
          </div>
          <div
            style={{
              borderRadius: 7,
              backgroundColor: "#191919",
              borderColor: "#333333",
              borderStyle: "solid",
              borderWidth: 1,
              width: 47,
              height: 47,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <img
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/7be1b55bfab27c01acb10d0264eafdf3e13a1676?placeholderIfAbsent=true"
              alt=""
              style={{ width: 20, aspectRatio: 1, objectFit: "contain" }}
            />
          </div>
        </div>
      </div>

      {/* Content Section */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          paddingLeft: 24,
          paddingRight: 24,
          marginTop: 35,
        }}
      >
        {/* Project Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 53,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                color: "#ffffff",
                fontSize: 17,
                fontFamily: "Inter, sans-serif",
                fontWeight: 500,
                lineHeight: 1.6,
              }}
            >
              {projectName}
            </div>
            <div
              style={{
                color: "#a4a4a4",
                fontSize: 12,
                fontFamily: "Inter, sans-serif",
                fontWeight: 400,
                lineHeight: 1.46,
              }}
            >
              {lastEdited}
            </div>
          </div>
          <img
            src={avatarImage}
            alt=""
            style={{
              width: 34,
              borderRadius: 20,
              aspectRatio: 1,
              objectFit: "cover",
            }}
          />
        </div>

        {/* Branches Section */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          {/* Branches Header */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 14,
            }}
          >
            <div
              style={{
                color: "#a4a4a4",
                fontSize: 14,
                fontFamily: "Inter, sans-serif",
                fontWeight: 500,
                lineHeight: 1.46,
              }}
            >
              Branches
            </div>
            {/* New Branch Button */}
            <div style={{ display: "flex" }}>
              <div
                style={{
                  borderRadius: "5px 0px 0px 5px",
                  borderStyle: "solid",
                  borderWidth: 1,
                  borderTopColor: "#315d8c",
                  borderRightColor: "#315d8c",
                  borderBottomColor: "#315d8c",
                  borderLeftColor: "#315d8c",
                  display: "flex",
                  paddingLeft: 11,
                  paddingRight: 10,
                  paddingTop: 4,
                  paddingBottom: 4,
                  alignItems: "center",
                  gap: 8,
                  cursor: "pointer",
                }}
              >
                <img
                  src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/df4f6946613156ecace8f0840ce156aa40ecd8a6?placeholderIfAbsent=true"
                  alt=""
                  style={{ width: 17, aspectRatio: 1, objectFit: "contain" }}
                />
                <div
                  style={{
                    color: "#48a1ff",
                    fontSize: 13,
                    fontFamily: "Inter, sans-serif",
                    fontWeight: 500,
                    lineHeight: "24px",
                  }}
                >
                  New Branch
                </div>
              </div>
              <div
                style={{
                  borderRadius: "0px 5px 5px 0px",
                  borderStyle: "solid",
                  borderTopWidth: 1,
                  borderRightWidth: 1,
                  borderBottomWidth: 1,
                  borderLeftWidth: 1,
                  borderTopColor: "#315d8c",
                  borderRightColor: "#315d8c",
                  borderBottomColor: "#315d8c",
                  borderLeftColor: "rgba(255, 255, 255, 0.1)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  paddingTop: 4,
                  paddingBottom: 4,
                  paddingLeft: 7,
                  paddingRight: 7,
                }}
              >
                <img
                  src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/3361faba58024c98c4344de953e554a121c05765?placeholderIfAbsent=true"
                  alt=""
                  style={{ width: 9, aspectRatio: 2.33, objectFit: "contain" }}
                />
              </div>
            </div>
          </div>

          {/* Branch List */}
          {branches.map((branch, index) => (
            <div
              key={index}
              style={{
                borderRadius: 7,
                backgroundColor: "#292929",
                display: "flex",
                padding: 10,
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: index < branches.length - 1 ? 10 : 0,
              }}
            >
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div
                  style={{
                    color: "#ffffff",
                    fontSize: 14,
                    fontFamily: "Inter, sans-serif",
                    fontWeight: 500,
                    lineHeight: 1.46,
                  }}
                >
                  {branch.name}
                </div>
                <div
                  style={{
                    color: "#a4a4a4",
                    fontSize: 12,
                    fontFamily: "Inter, sans-serif",
                    fontWeight: 400,
                    lineHeight: 1.46,
                  }}
                >
                  {branch.timeAgo}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <img
                  src={branch.avatarImage}
                  alt=""
                  style={{
                    width: 24,
                    borderRadius: 20,
                    aspectRatio: 1,
                    objectFit: "cover",
                  }}
                />
                <img
                  src={branch.statusIcon}
                  alt=""
                  style={{
                    width: 16,
                    aspectRatio: 0.93,
                    objectFit: "contain",
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Footer Links */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 35,
            color: "#a4a4a4",
            fontSize: 13,
            fontFamily: "Inter, sans-serif",
            fontWeight: 500,
            lineHeight: "24px",
          }}
        >
          <div style={{ cursor: "pointer" }}>Show more</div>
          <div style={{ cursor: "pointer" }}>View all branches</div>
        </div>
      </div>
    </div>
  );
};

// Preview composition
export const ProjectCardPreview = createInteractiveComposition({
  component: ProjectCard,
  width: 1920,
  height: 1080,
  durationInFrames: 150,
  fps: 30,
  tracks: [],
  defaultProps: {
    x: 811,
    y: 150,
  },
});
