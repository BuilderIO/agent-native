/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CODE PANEL ORGANISM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A complete code explorer panel showing file changes and project structure.
 * Demonstrates atomic design composition (organism made of atoms).
 *
 * Features:
 * - Top bar with user avatars and action buttons
 * - Changes section (modified files)
 * - File explorer with folder tree
 * - Bottom action buttons
 * - All interactive elements with hover effects
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { createInteractiveComposition } from "@/remotion/hooks/createInteractiveComposition";
import { useInteractiveComponent } from "@/remotion/hooks/useInteractiveComponent";
import { AnimatedElement } from "@/remotion/components/AnimatedElement";
import { createCameraTrack, createCursorTrack } from "@/remotion/trackHelpers";
import type { AnimationTrack, AnimationShorthand } from "@/types";

// Custom brightness hover animation
const brightnessHover = (amount: number): AnimationShorthand => ({
  duration: 6,
  easing: "expo.out",
  properties: [
    { property: "brightness", from: 1, to: 1 + amount, unit: "" },
  ],
});

// Internal helper components (not exported - used only within CodePanel)
// These handle optional interactive props by conditionally rendering AnimatedElement
type InternalFileItemProps = {
  icon: string;
  name: string;
  lineCount?: string;
  path?: string;
  x: number;
  y: number;
  interactive?: any;
};

const InternalFileItem: React.FC<InternalFileItemProps> = ({
  icon,
  name,
  lineCount,
  path,
  x,
  y,
  interactive,
}) => {
  const content = (
    <>
      <img
        src={icon}
        alt=""
        style={{
          aspectRatio: 1,
          objectFit: "contain",
          objectPosition: "center",
          width: 16,
          flexShrink: 0,
        }}
      />
      <div style={{ fontSize: 13, color: "#a4a4a4", flexShrink: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
        {name}
      </div>
      {lineCount && (
        <div style={{ fontSize: 11, color: "#4ade80", marginLeft: "auto", flexShrink: 0 }}>
          {lineCount}
        </div>
      )}
      {path && (
        <div style={{ fontSize: 11, color: "#8a8a8a", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {path}
        </div>
      )}
    </>
  );

  const containerStyle = {
    position: "absolute" as const,
    left: x,
    top: y,
    width: 260,
    height: 24,
    display: "flex",
    alignItems: "center" as const,
    gap: "7px",
    cursor: interactive ? "pointer" : "default" as const,
    overflow: "hidden" as const,
    whiteSpace: "nowrap" as const,
  };

  if (interactive) {
    return (
      <AnimatedElement interactive={interactive} as="div" style={containerStyle}>
        {content}
      </AnimatedElement>
    );
  }

  return <div style={containerStyle}>{content}</div>;
};

type InternalFolderItemProps = {
  name: string;
  isExpanded?: boolean;
  x: number;
  y: number;
  interactive?: any;
};

const InternalFolderItem: React.FC<InternalFolderItemProps> = ({
  name,
  isExpanded = false,
  x,
  y,
  interactive,
}) => {
  const content = (
    <>
      {isExpanded ? (
        <div style={{ display: "flex", paddingLeft: 5, paddingRight: 5, paddingTop: 4, paddingBottom: 4, alignItems: "center", overflow: "hidden", width: 14 }}>
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/2f7e835c418bdf085373048598835166dfbceb0c?placeholderIfAbsent=true"
            alt=""
            style={{
              aspectRatio: 0.57,
              objectFit: "contain",
              objectPosition: "center",
              width: 4,
              flexShrink: 0,
            }}
          />
        </div>
      ) : (
        <img
          src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/13dadd4473c8a647901e721f8b909948c3fb26f9?placeholderIfAbsent=true"
          alt=""
          style={{
            aspectRatio: 1,
            objectFit: "contain",
            objectPosition: "center",
            width: 14,
            flexShrink: 0,
          }}
        />
      )}
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <img
          src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/0eff81acf5a556bcdb7fe959d106beee500c5274?placeholderIfAbsent=true"
          alt=""
          style={{
            aspectRatio: 1,
            objectFit: "contain",
            objectPosition: "center",
            width: 16,
            flexShrink: 0,
          }}
        />
        <div style={{ fontSize: 13, color: "#a4a4a4", whiteSpace: "nowrap" }}>
          {name}
        </div>
      </div>
    </>
  );

  const containerStyle = {
    position: "absolute" as const,
    left: x,
    top: y,
    width: 260,
    height: 24,
    display: "flex",
    alignItems: isExpanded ? "end" : "center" as const,
    gap: isExpanded ? "5px" : "4px",
    cursor: interactive ? "pointer" : "default" as const,
  };

  if (interactive) {
    return (
      <AnimatedElement interactive={interactive} as="div" style={containerStyle}>
        {content}
      </AnimatedElement>
    );
  }

  return <div style={containerStyle}>{content}</div>;
};

export type CodePanelProps = {
  backgroundColor?: string;
  tracks?: AnimationTrack[];
};

// Fallback tracks with cursor interactions
const FALLBACK_TRACKS: AnimationTrack[] = (() => {
  const tracks = [
    createCameraTrack(150),
    createCursorTrack(150, { startX: 200, startY: 900 }),
  ];
  const cursor = tracks[1];

  // Cursor path: Start offscreen → hover files → hover Send PR → exit
  cursor.animatedProps.find(p => p.property === "x")!.keyframes = [
    { frame: 0, value: "200" },
    { frame: 15, value: "180" },  // Hover first file
    { frame: 40, value: "180" },
    { frame: 50, value: "200" },  // Move to Send PR
    { frame: 60, value: "200" },
    { frame: 90, value: "200" },
    { frame: 120, value: "1720" },
    { frame: 150, value: "1720" },
  ];
  cursor.animatedProps.find(p => p.property === "y")!.keyframes = [
    { frame: 0, value: "900" },
    { frame: 15, value: "200" },
    { frame: 40, value: "200" },
    { frame: 50, value: "80" },   // Move to top bar
    { frame: 60, value: "80" },
    { frame: 90, value: "80" },
    { frame: 120, value: "80" },
    { frame: 150, value: "80" },
  ];
  cursor.animatedProps.find(p => p.property === "isClicking")!.keyframes = [
    { frame: 0, value: "0" },
    { frame: 75, value: "0" },
    { frame: 76, value: "1" },  // Click Send PR
    { frame: 85, value: "0" },
    { frame: 150, value: "0" },
  ];
  cursor.animatedProps.find(p => p.property === "opacity")!.keyframes = [
    { frame: 0, value: "0" },
    { frame: 10, value: "1" },
    { frame: 120, value: "1" },
    { frame: 135, value: "0" },
    { frame: 150, value: "0" },
  ];

  return tracks;
})();

export const CodePanel = createInteractiveComposition<CodePanelProps>({
  fallbackTracks: FALLBACK_TRACKS,
  
  render: ({ cursorHistory, registerForCursor }, props) => {
    const { backgroundColor = "#1a1a1a" } = props;
    const { width, height } = useVideoConfig();

    const panelWidth = 306;
    const panelX = (width - panelWidth) / 2;
    const padding = 14;

    // Interactive elements
    const shareButton = useInteractiveComponent({
      id: "share-btn",
      elementType: "Button",
      label: "Share",
      compositionId: "code-panel",
      zone: { x: panelX + 110, y: 28, width: 55, height: 32 },
      cursorHistory,
      interactiveElementType: "button",
      hoverAnimation: brightnessHover(0.2),
    });

    const sendPRButton = useInteractiveComponent({
      id: "sendpr-btn",
      elementType: "Button",
      label: "Send PR",
      compositionId: "code-panel",
      zone: { x: panelX + 173, y: 28, width: 82, height: 32 },
      cursorHistory,
      interactiveElementType: "button",
      hoverAnimation: brightnessHover(0.3),
    });

    const file1 = useInteractiveComponent({
      id: "file-globalcss",
      elementType: "FileItem",
      label: "global.css",
      compositionId: "code-panel",
      zone: { x: panelX + 29, y: 187, width: 260, height: 24 },
      cursorHistory,
      interactiveElementType: "card",
      hoverAnimation: brightnessHover(0.15),
    });

    const file2 = useInteractiveComponent({
      id: "file-animated",
      elementType: "FileItem",
      label: "AnimatedCursor.tsx",
      compositionId: "code-panel",
      zone: { x: panelX + 29, y: 211, width: 260, height: 24 },
      cursorHistory,
      interactiveElementType: "card",
      hoverAnimation: brightnessHover(0.15),
    });

    const folder1 = useInteractiveComponent({
      id: "folder-client",
      elementType: "FolderItem",
      label: "client",
      compositionId: "code-panel",
      zone: { x: panelX + 32, y: 435, width: 200, height: 24 },
      cursorHistory,
      interactiveElementType: "card",
      hoverAnimation: brightnessHover(0.12),
    });

    const pushButton = useInteractiveComponent({
      id: "push-btn",
      elementType: "Button",
      label: "Push to Remote",
      compositionId: "code-panel",
      zone: { x: panelX + 20, y: 897, width: 266, height: 33 },
      cursorHistory,
      interactiveElementType: "button",
      hoverAnimation: brightnessHover(0.2),
    });

    // Register all for cursor
    registerForCursor(shareButton);
    registerForCursor(sendPRButton);
    registerForCursor(file1);
    registerForCursor(file2);
    registerForCursor(folder1);
    registerForCursor(pushButton);

    return (
      <AbsoluteFill style={{ backgroundColor: "#0a0a0a" }}>
        {/* Main Panel Container */}
        <div
          style={{
            position: "absolute",
            left: panelX,
            top: 14,
            width: panelWidth,
            height: height - 28,
            backgroundColor,
            borderRadius: 0,
            paddingTop: 14,
            paddingBottom: 14,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Top Bar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              paddingLeft: padding,
              paddingRight: padding,
              marginBottom: 20,
            }}
          >
            {/* Builder Logo */}
            <img
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/0cf56d589a544eb3f55d68424b7dcd2bc92ae95b?placeholderIfAbsent=true"
              alt="Builder"
              style={{
                aspectRatio: 1.67,
                objectFit: "contain",
                objectPosition: "center",
                width: 40,
                borderRadius: 0,
              }}
            />

            {/* Action Buttons */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              {/* Play Button */}
              <img
                src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/e29432f6c2d0b272f77bc1c4071ed9a1cdc1d780?placeholderIfAbsent=true"
                alt=""
                style={{
                  aspectRatio: 1,
                  objectFit: "contain",
                  objectPosition: "center",
                  width: 16,
                }}
              />

              {/* Share Button */}
              <div style={{ position: "relative", width: 55, height: 32 }}>
                <AnimatedElement
                  interactive={shareButton}
                  as="div"
                  style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    paddingLeft: 11,
                    paddingRight: 11,
                    paddingTop: 5,
                    paddingBottom: 5,
                    backgroundColor: "#2a2a2a",
                    border: "1px solid #393939",
                    borderRadius: 6,
                    color: "#fff",
                    fontSize: 11,
                    fontWeight: 500,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  Share
                </AnimatedElement>
              </div>

              {/* Send PR Button */}
              <div
                style={{
                  position: "relative",
                  width: 82,
                  height: 32,
                }}
              >
                <AnimatedElement
                  interactive={sendPRButton}
                  as="div"
                  style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "start",
                    gap: 4,
                    paddingLeft: 7,
                    paddingRight: 7,
                    paddingTop: 5,
                    paddingBottom: 5,
                    backgroundColor: "#48a1ff",
                    borderRadius: 6,
                    color: "#000",
                    fontSize: 11,
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  <img
                    src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/81e7eb620e52aae529258200f6dff2cc38027cd8?placeholderIfAbsent=true"
                    alt=""
                    style={{
                      aspectRatio: 1,
                      objectFit: "contain",
                      objectPosition: "center",
                      width: 16,
                    }}
                  />
                  <span>Send PR</span>
                </AnimatedElement>
              </div>

              {/* Three Dots Menu */}
              <img
                src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/bc09478d2b1c91ed9ad1781d20ad0f177cd917de?placeholderIfAbsent=true"
                alt=""
                style={{
                  aspectRatio: 1,
                  objectFit: "contain",
                  objectPosition: "center",
                  width: 16,
                }}
              />
            </div>
          </div>

          {/* Changes Section */}
          <div
            style={{
              borderBottom: "1px solid #333",
              paddingBottom: 13,
              flexShrink: 0,
            }}
          >
            {/* Changes Header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                paddingLeft: padding,
                paddingRight: padding,
                marginBottom: 13,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#a4a4a4",
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                }}
              >
                <img
                  src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/f872b16106ef6bbaea80fcefece2392325659d2c?placeholderIfAbsent=true"
                  alt=""
                  style={{
                    aspectRatio: 1,
                    objectFit: "contain",
                    objectPosition: "center",
                    width: 14,
                  }}
                />
                <span>ALL CHANGES</span>
                <img
                  src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/3530c0f5bec8d31ae691dcc0fc4121d9e44fda5c?placeholderIfAbsent=true"
                  alt=""
                  style={{
                    aspectRatio: 1,
                    objectFit: "contain",
                    objectPosition: "center",
                    width: 12,
                  }}
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <img
                  src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/b1934ade6735dc20769f1c35fe91cbc22e3a748a?placeholderIfAbsent=true"
                  alt=""
                  style={{
                    aspectRatio: 1,
                    objectFit: "contain",
                    objectPosition: "center",
                    width: 16,
                  }}
                />
                <img
                  src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/7507cd846d78cc70e45f11ffa788e6042a38afd5?placeholderIfAbsent=true"
                  alt=""
                  style={{
                    aspectRatio: 1,
                    objectFit: "contain",
                    objectPosition: "center",
                    width: 16,
                  }}
                />
                <img
                  src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/5c3993b62d6cd90fdc4e6e888c664bdd04664087?placeholderIfAbsent=true"
                  alt=""
                  style={{
                    aspectRatio: 1,
                    objectFit: "contain",
                    objectPosition: "center",
                    width: 16,
                  }}
                />
              </div>
            </div>

            {/* File List - Changes */}
            <div
              className="scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-transparent"
              style={{
                height: 168,
                overflowY: "auto",
                overflowX: "hidden",
                position: "relative",
              }}
            >
              <InternalFileItem
                icon="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/7278d98fbf7842c6277f1d9ab3fc19a357056cda?placeholderIfAbsent=true"
                name="global.css"
                lineCount="+ 42"
                path="client"
                x={padding + 15}
                y={0}
                interactive={file1}
              />
              <InternalFileItem
                icon="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/10ff8b681a169f3c2b0c90b4fd672a0e7173771b?placeholderIfAbsent=true"
                name="AnimatedCursor.tsx"
                lineCount="+ 123"
                path="client/remot..."
                x={padding + 15}
                y={24}
                interactive={file2}
              />
              <InternalFileItem
                icon="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/10ff8b681a169f3c2b0c90b4fd672a0e7173771b?placeholderIfAbsent=true"
                name="BrowserChrome.tsx"
                lineCount="+ 190"
                path="client/remot..."
                x={padding + 15}
                y={48}
              />
              <InternalFileItem
                icon="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/e80d97b098bd0dceebc27fb5fda447da0442e4bb?placeholderIfAbsent=true"
                name="README.md"
                lineCount="+ 76"
                path="client/remotion/comp..."
                x={padding + 15}
                y={72}
              />
              <InternalFileItem
                icon="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/453a94c1ff34b36dcaefbd976adf02161b120d68?placeholderIfAbsent=true"
                name="index.ts"
                lineCount="+ 4"
                path="client/remotion/components"
                x={padding + 15}
                y={96}
              />
              <InternalFileItem
                icon="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/10ff8b681a169f3c2b0c90b4fd672a0e7173771b?placeholderIfAbsent=true"
                name="KineticText.tsx"
                lineCount="+ 2"
                path="client/remotion/comp..."
                x={padding + 15}
                y={120}
              />
              <InternalFileItem
                icon="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/453a94c1ff34b36dcaefbd976adf02161b120d68?placeholderIfAbsent=true"
                name="types.ts"
                lineCount="+ 27"
                path="client"
                x={padding + 15}
                y={144}
              />
              <InternalFileItem
                icon="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/10ff8b681a169f3c2b0c90b4fd672a0e7173771b?placeholderIfAbsent=true"
                name="AnimationPresets.ts"
                lineCount="+ 56"
                path="client/remotion"
                x={padding + 15}
                y={168}
              />
              <InternalFileItem
                icon="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/10ff8b681a169f3c2b0c90b4fd672a0e7173771b?placeholderIfAbsent=true"
                name="Card.tsx"
                lineCount="+ 89"
                path="client/remotion/lib..."
                x={padding + 15}
                y={192}
              />
              <InternalFileItem
                icon="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/10ff8b681a169f3c2b0c90b4fd672a0e7173771b?placeholderIfAbsent=true"
                name="Button.tsx"
                lineCount="+ 67"
                path="client/remotion/lib..."
                x={padding + 15}
                y={216}
              />
              <InternalFileItem
                icon="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/453a94c1ff34b36dcaefbd976adf02161b120d68?placeholderIfAbsent=true"
                name="trackHelpers.ts"
                lineCount="+ 34"
                path="client/remotion"
                x={padding + 15}
                y={240}
              />
              <InternalFileItem
                icon="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/10ff8b681a169f3c2b0c90b4fd672a0e7173771b?placeholderIfAbsent=true"
                name="Root.tsx"
                lineCount="+ 15"
                path="client/remotion"
                x={padding + 15}
                y={264}
              />
              <InternalFileItem
                icon="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/7278d98fbf7842c6277f1d9ab3fc19a357056cda?placeholderIfAbsent=true"
                name="App.css"
                lineCount="+ 8"
                path="client"
                x={padding + 15}
                y={288}
              />
            </div>
          </div>

          {/* Files Section */}
          <div
            style={{
              marginTop: 13,
              paddingLeft: padding,
              paddingRight: padding,
              flex: 1,
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
            }}
          >
            {/* Files Header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 12,
                fontSize: 11,
                fontWeight: 600,
                color: "#a4a4a4",
                letterSpacing: 0.5,
                textTransform: "uppercase",
              }}
            >
              <div style={{ display: "flex", alignItems: "start", gap: 4 }}>
                <img
                  src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/f872b16106ef6bbaea80fcefece2392325659d2c?placeholderIfAbsent=true"
                  alt=""
                  style={{
                    aspectRatio: 1,
                    objectFit: "contain",
                    objectPosition: "center",
                    width: 14,
                  }}
                />
                <span>ALL FILES</span>
              </div>
              <img
                src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/f880c0545d0074a824eaf167115bd9758f1a18b6?placeholderIfAbsent=true"
                alt=""
                style={{
                  aspectRatio: 1,
                  objectFit: "contain",
                  objectPosition: "center",
                  width: 16,
                }}
              />
            </div>

            {/* Folder Tree */}
            <div
              className="scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-transparent"
              style={{ position: "relative", flex: 1, overflowY: "auto", overflowX: "hidden", minHeight: 0 }}
            >
              <InternalFolderItem
                name=".builder"
                x={0}
                y={0}
              />
              <InternalFolderItem
                name="client"
                isExpanded={false}
                x={0}
                y={24}
                interactive={folder1}
              />
              <InternalFolderItem
                name="netlify"
                x={0}
                y={48}
              />
              <InternalFolderItem
                name="public"
                x={0}
                y={72}
              />
              <InternalFolderItem
                name="server"
                x={0}
                y={96}
              />
              <InternalFolderItem
                name="shared"
                isExpanded={true}
                x={0}
                y={120}
              />

              {/* Files under Shared */}
              <InternalFileItem
                icon="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/a19fa843f4a7191fd614f9b76ae47d9dd8b0710a?placeholderIfAbsent=true"
                name=".dockerignore"
                x={18}
                y={144}
              />
              <InternalFileItem
                icon="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/9d0559aa66f055bfc2bc0998afb6d82ba6273ab8?placeholderIfAbsent=true"
                name=".env"
                x={18}
                y={168}
              />
              <InternalFileItem
                icon="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/f46ff0bff72a846d98efef6f42e2e3921ce09a6d?placeholderIfAbsent=true"
                name=".gitignore"
                x={18}
                y={192}
              />
              <InternalFileItem
                icon="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/73d662436f5fd4e2fe902fd900a6e61f9c20a7e0?placeholderIfAbsent=true"
                name=".npmrc"
                x={18}
                y={216}
              />
              <InternalFileItem
                icon="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/73d662436f5fd4e2fe902fd900a6e61f9c20a7e0?placeholderIfAbsent=true"
                name=".prettierrc"
                x={18}
                y={240}
              />
              <InternalFileItem
                icon="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/e80d97b098bd0dceebc27fb5fda447da0442e4bb?placeholderIfAbsent=true"
                name="AGENTS.md"
                x={18}
                y={264}
              />
              <InternalFileItem
                icon="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/1213ab21646d881bd6ed70606123b9bf35c46784?placeholderIfAbsent=true"
                name="components.json"
                x={18}
                y={288}
              />
              <InternalFileItem
                icon="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/109f3e7fd9754552cc8f777f1a9efbffd892dad2?placeholderIfAbsent=true"
                name="index.html"
                x={18}
                y={312}
              />
              <InternalFileItem
                icon="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/73d662436f5fd4e2fe902fd900a6e61f9c20a7e0?placeholderIfAbsent=true"
                name="netlify.toml"
                x={18}
                y={336}
              />
              <InternalFileItem
                icon="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/5bc4a217539e10100dec59a6987d4b5a397d3113?placeholderIfAbsent=true"
                name="package.json"
                x={18}
                y={360}
              />
              <InternalFileItem
                icon="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/09ee71eb54e58063404e147088bb0e3c9c921eac?placeholderIfAbsent=true"
                name="pnpm-lock.yaml"
                x={18}
                y={384}
              />
              <InternalFileItem
                icon="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/e7337860c061c204f19bb7fb47965767fafcbe8c?placeholderIfAbsent=true"
                name="postcss.config.js"
                x={18}
                y={408}
              />
              <InternalFileItem
                icon="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/453a94c1ff34b36dcaefbd976adf02161b120d68?placeholderIfAbsent=true"
                name="tailwind.config.ts"
                x={18}
                y={432}
              />
              <InternalFileItem
                icon="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/5bc4a217539e10100dec59a6987d4b5a397d3113?placeholderIfAbsent=true"
                name="tsconfig.json"
                x={18}
                y={456}
              />
              <InternalFileItem
                icon="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/453a94c1ff34b36dcaefbd976adf02161b120d68?placeholderIfAbsent=true"
                name="vite.config.server.ts"
                x={18}
                y={480}
              />
              <InternalFileItem
                icon="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/453a94c1ff34b36dcaefbd976adf02161b120d68?placeholderIfAbsent=true"
                name="vite.config.ts"
                x={18}
                y={504}
              />
            </div>
          </div>

          {/* Bottom Section */}
          <div
            style={{
              borderTop: "1px solid #333",
              marginTop: 29,
              paddingTop: 20,
              paddingLeft: 20,
              paddingRight: 20,
              paddingBottom: 20,
              flexShrink: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {/* Edit Locally Info */}
            <div style={{ marginBottom: 9, width: "100%" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "start",
                  gap: 4,
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#a4a4a4",
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                  marginBottom: 8,
                }}
              >
                <img
                  src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/a9d23b47e885c8763a1cfc52c49a52aa0a25be67?placeholderIfAbsent=true"
                  alt=""
                  style={{
                    aspectRatio: 1,
                    objectFit: "contain",
                    objectPosition: "center",
                    width: 14,
                  }}
                />
                <span>Edit Locally</span>
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "#9c9c9c",
                  fontWeight: 400,
                  lineHeight: "15px",
                  width: "100%",
                }}
              >
                Pull this branch locally, edit in your IDE, then push changes back.
              </div>
            </div>

            {/* Push to Remote Button */}
            <div style={{ position: "relative", width: "100%", alignSelf: "center" }}>
              <AnimatedElement
                interactive={pushButton}
                as="div"
                style={{
                  width: "100%",
                  minHeight: 33,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  paddingLeft: 17,
                  paddingRight: 17,
                  paddingTop: 6,
                  paddingBottom: 6,
                  backgroundColor: "#2a2a2a",
                  border: "1px solid #393939",
                  borderRadius: 6,
                  color: "#fff",
                  fontSize: 12,
                  fontWeight: 500,
                  textAlign: "center",
                  lineHeight: "22px",
                  cursor: "pointer",
                }}
              >
                <img
                  src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/ebb87455f766e0b07af344a33aa040bd10f21253?placeholderIfAbsent=true"
                  alt=""
                  style={{
                    aspectRatio: 1,
                    objectFit: "contain",
                    objectPosition: "center",
                    width: 14,
                  }}
                />
                <span>Push to Remote</span>
              </AnimatedElement>
            </div>
          </div>
        </div>
      </AbsoluteFill>
    );
  },
});
