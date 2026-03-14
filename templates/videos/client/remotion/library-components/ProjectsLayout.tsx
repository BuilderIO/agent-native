/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PROJECTS LAYOUT ORGANISM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Complete projects layout combining the StandardSidebar with the ProjectsScreen.
 * Demonstrates the full Builder.io projects interface layout.
 *
 * Features:
 * - StandardSidebar navigation on the left (61px width)
 * - ProjectsScreen main content area
 * - Full dark theme layout
 * - Proper spacing and composition
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React from "react";
import { createInteractiveComposition } from "@/remotion/hooks/createInteractiveComposition";
import type { AnimationTrack } from "@/types";
import { ProjectsScreen } from "./ProjectsScreen";

export type ProjectsLayoutProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  tracks?: AnimationTrack[];
  promptHasText?: boolean;
  promptValue?: string;
  promptIsFocused?: boolean;
  showTypingCursor?: boolean;
  typingCursorBlink?: boolean;
  cogButtonIsHovered?: boolean;
  reactViteIsHovered?: boolean;
  oneXIsHovered?: boolean;
  buildButtonIsHovered?: boolean;
  sendButtonIsHovered?: boolean;
  sendButtonHoverProgress?: number;
  sendButtonIsClicking?: boolean;
  connectRepoIsHovered?: boolean;
  template1IsHovered?: boolean;
  template2IsHovered?: boolean;
  moreButtonIsHovered?: boolean;
  showDropdown?: boolean;
  dropdownX?: number;
  dropdownY?: number;
  githubProviderIsHovered?: boolean;
  azureProviderIsHovered?: boolean;
  gitlabProviderIsHovered?: boolean;
  bitbucketProviderIsHovered?: boolean;
};

export const ProjectsLayout: React.FC<ProjectsLayoutProps> = (props) => {
  const {
    x = 0,
    y = 0,
    width = 1920,
    height = 1080,
    tracks = [],
    promptHasText = false,
    promptValue = "",
    promptIsFocused = false,
    showTypingCursor = false,
    typingCursorBlink = true,
    cogButtonIsHovered = false,
    reactViteIsHovered = false,
    oneXIsHovered = false,
    buildButtonIsHovered = false,
    sendButtonIsHovered = false,
    sendButtonHoverProgress = 0,
    sendButtonIsClicking = false,
    connectRepoIsHovered = false,
    template1IsHovered = false,
    template2IsHovered = false,
    moreButtonIsHovered = false,
    showDropdown = false,
    dropdownX = 0,
    dropdownY = 0,
    githubProviderIsHovered = false,
    azureProviderIsHovered = false,
    gitlabProviderIsHovered = false,
    bitbucketProviderIsHovered = false,
  } = props;

  // Padding around the composition
  const padding = 100;
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: width,
        height: height,
        backgroundColor: "#0a0a0a", // Darker background for visible padding area
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: padding,
      }}
    >
      {/* Inner container with shadow */}
      <div
        style={{
          width: innerWidth,
          height: innerHeight,
          backgroundColor: "#1d1d1d",
          display: "flex",
          borderRadius: 20,
          overflow: "hidden",
          boxShadow: "0 20px 60px rgba(0, 0, 0, 0.5)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
        }}
      >
      {/* Standard Sidebar */}
      <div
        style={{
          width: 73,
          backgroundColor: "#191919",
          borderRightWidth: 1,
          borderRightStyle: "solid",
          borderColor: "#434343",
          display: "flex",
          flexDirection: "column",
          height: "100%",
        }}
      >
        {/* Builder Logo */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginTop: 32,
          }}
        >
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/966f87fd9ce8ed77d54c82370920ca1442022a1b"
            alt=""
            style={{
              width: 25,
              aspectRatio: 0.87,
              objectFit: "contain",
            }}
          />
        </div>

        {/* Divider */}
        <div
          style={{
            backgroundColor: "#434343",
            height: 1,
            marginTop: 14,
            marginLeft: 14,
            marginRight: 14,
          }}
        />

        {/* Navigation Icons */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            marginTop: 20,
          }}
        >
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/42fc1b7f6063134a23dfe7b036d5d0e24e63c032"
            alt=""
            style={{ width: 29, marginTop: 19, cursor: "pointer" }}
          />
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/e36ac2614b296ed36bdf254bd107955b67f9edd2"
            alt=""
            style={{ width: "100%", marginTop: 12, cursor: "pointer" }}
          />
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/2c4b3903a0a1191b0bf7c4542f996b8e862eee8d"
            alt=""
            style={{ width: 29, marginTop: 13, cursor: "pointer" }}
          />
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/3e300d3891e92e9b4f2d7313ec72728cdf837742"
            alt=""
            style={{ width: 29, marginTop: 23, cursor: "pointer" }}
          />
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/91cb84fd7d3618b896ce78632d230016ca2b821d"
            alt=""
            style={{ width: 29, marginTop: 24, cursor: "pointer" }}
          />
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/40ff2803a56a757f6e98235cabbcd6b002eb9364"
            alt=""
            style={{ width: 29, marginTop: 24, cursor: "pointer" }}
          />
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/e1947f95173604c83cd2469c3cb7999255c70e5c"
            alt=""
            style={{ width: 29, marginTop: 23, cursor: "pointer" }}
          />
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/ee47b45dccc99e1b3ebca60dd313ef0ab9f1f1e4"
            alt=""
            style={{ width: 29, marginTop: 24, cursor: "pointer" }}
          />
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/76d18c16af1b61f3b40a7b9de216cef5ff520c2f"
            alt=""
            style={{ width: 29, marginTop: 23, cursor: "pointer" }}
          />
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/93aa6ef23aad32998dce678aa612c0b7a9474a09"
            alt=""
            style={{ width: 29, marginTop: 25, cursor: "pointer" }}
          />
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/0363f0ba488cfcb5e876036c74712f3478760018"
            alt=""
            style={{ width: 29, marginTop: 24, cursor: "pointer" }}
          />
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/43d76a828ee652f47fd45f221377b268a4fb2169"
            alt=""
            style={{ width: 29, marginTop: 23, cursor: "pointer" }}
          />
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/fe97c6fbd956ec1632be9e9fc14f7cffa5ebe5a3"
            alt=""
            style={{ width: 29, marginTop: 24, cursor: "pointer" }}
          />
        </div>

        {/* User/Settings Icon at Bottom */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginTop: "auto",
            marginBottom: 32,
          }}
        >
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/eb90703132a91eddf5530d9e82c1016b7bf1a185"
            alt=""
            style={{ width: 29, cursor: "pointer" }}
          />
        </div>
      </div>

        {/* Projects Screen Content */}
        <div
          style={{
            flex: 1,
            position: "relative",
          }}
        >
          <ProjectsScreen
            x={0}
            y={0}
            width={innerWidth - 73}
            height={innerHeight}
            promptHasText={promptHasText}
            promptValue={promptValue}
            promptIsFocused={promptIsFocused}
            showTypingCursor={showTypingCursor}
            typingCursorBlink={typingCursorBlink}
            cogButtonIsHovered={cogButtonIsHovered}
            reactViteIsHovered={reactViteIsHovered}
            oneXIsHovered={oneXIsHovered}
            buildButtonIsHovered={buildButtonIsHovered}
            sendButtonIsHovered={sendButtonIsHovered}
            sendButtonHoverProgress={sendButtonHoverProgress}
            sendButtonIsClicking={sendButtonIsClicking}
            connectRepoIsHovered={connectRepoIsHovered}
            template1IsHovered={template1IsHovered}
            template2IsHovered={template2IsHovered}
            moreButtonIsHovered={moreButtonIsHovered}
            showDropdown={showDropdown}
            dropdownX={dropdownX}
            dropdownY={dropdownY}
            githubProviderIsHovered={githubProviderIsHovered}
            azureProviderIsHovered={azureProviderIsHovered}
            gitlabProviderIsHovered={gitlabProviderIsHovered}
            bitbucketProviderIsHovered={bitbucketProviderIsHovered}
          />
        </div>
      </div>
    </div>
  );
};

// Preview composition with padding
export const ProjectsLayoutPreview = createInteractiveComposition({
  component: ProjectsLayout,
  width: 1920,
  height: 1080,
  durationInFrames: 150,
  fps: 30,
  tracks: [],
  defaultProps: {
    x: 0,
    y: 0,
  },
});
