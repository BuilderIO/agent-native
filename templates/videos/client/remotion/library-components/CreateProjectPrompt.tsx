/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CREATE PROJECT PROMPT ORGANISM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The "What should we build?" prompt section with template selection and
 * creation controls. Appears at the top of the Projects screen.
 *
 * Features:
 * - Main heading "What should we build?"
 * - Ask Builder input area
 * - React + Vite template selector
 * - Build configuration controls
 * - Connect Repo button
 * - Template and action buttons
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React from "react";
import { createInteractiveComposition } from "@/remotion/hooks/createInteractiveComposition";
import type { AnimationTrack } from "@/types";
import { GitProvidersDropdown } from "@/components/GitProvidersDropdown";
import { useEditableZones, type Zone } from "@/remotion/hooks/useEditableZones";

export type CreateProjectPromptProps = {
  x?: number;
  y?: number;
  width?: number;
  tracks?: AnimationTrack[];
  hasText?: boolean;
  isHovered?: boolean;
  hoverProgress?: number;
  isClicking?: boolean;
  isFocused?: boolean; // For composition control - shows blue outline
  // Control button hover states (inside grey card)
  cogButtonIsHovered?: boolean;
  reactViteIsHovered?: boolean;
  oneXIsHovered?: boolean;
  buildButtonIsHovered?: boolean;
  // Action button hover states
  connectRepoIsHovered?: boolean;
  template1IsHovered?: boolean;
  template2IsHovered?: boolean;
  moreButtonIsHovered?: boolean;
  // Interactive mode props
  value?: string;
  onChange?: (value: string) => void;
  onSend?: () => void;
  interactive?: boolean;
  showTypingCursor?: boolean;
  typingCursorBlink?: boolean; // Controls whether cursor is currently visible (blink state)
  // Dropdown control
  showDropdown?: boolean;
  dropdownOpacity?: number;
  dropdownX?: number;
  dropdownY?: number;
  onSelectProvider?: (provider: string) => void;
  // Dropdown item hover states
  githubProviderIsHovered?: boolean;
  azureProviderIsHovered?: boolean;
  gitlabProviderIsHovered?: boolean;
  bitbucketProviderIsHovered?: boolean;
  // Debug mode for zone editing
  debugMode?: boolean;
};

export const CreateProjectPrompt: React.FC<CreateProjectPromptProps> = (
  props
) => {
  const {
    x = 0,
    y = 0,
    width = 790,
    tracks = [],
    hasText = false,
    isHovered = false,
    hoverProgress = 0,
    isClicking = false,
    isFocused: isFocusedProp = false,
    cogButtonIsHovered = false,
    reactViteIsHovered = false,
    oneXIsHovered = false,
    buildButtonIsHovered = false,
    connectRepoIsHovered = false,
    template1IsHovered = false,
    template2IsHovered = false,
    moreButtonIsHovered = false,
    value = "",
    onChange,
    onSend,
    interactive = false,
    showTypingCursor = false,
    typingCursorBlink = true,
    showDropdown: showDropdownProp = false,
    dropdownOpacity = 1,
    dropdownX: dropdownXProp,
    dropdownY: dropdownYProp,
    onSelectProvider,
    githubProviderIsHovered = false,
    azureProviderIsHovered = false,
    gitlabProviderIsHovered = false,
    bitbucketProviderIsHovered = false,
    debugMode = false,
  } = props;

  // Track textarea focus state (only used in interactive mode)
  const [isFocusedState, setIsFocusedState] = React.useState(false);

  // Track dropdown visibility (only used in interactive mode)
  const [showDropdownState, setShowDropdownState] = React.useState(false);

  // Define default zones relative to the component (0,0 is top-left of component)
  const defaultZones = React.useMemo(() => ({
    Input: { x: 18, y: 69, width: width - 36, height: 100 }, // Inside card, after heading
    Cog: { x: 16, y: 187, width: 30, height: 30 }, // Controls row
    React: { x: 52, y: 187, width: 130, height: 30 }, // React + Vite button
    '1x': { x: width - 16 - 220, y: 187, width: 55, height: 30 }, // Approximate right side positioning
    Build: { x: width - 16 - 143, y: 187, width: 102, height: 30 }, // Build button
    Send: { x: width - 16 - 29, y: 187, width: 29, height: 29 }, // Send button (rightmost)
  }), [width]);

  // Use editable zones hook
  const { zones, ZoneEditor } = useEditableZones({
    componentId: 'create-project-prompt',
    defaultZones,
    enabled: debugMode,
  });

  // Use prop when provided (composition mode), otherwise use state (interactive mode)
  const isFocused = interactive ? isFocusedState : isFocusedProp;
  const showDropdown = interactive ? showDropdownState : showDropdownProp;

  // Handle Connect Repo button click (interactive mode only)
  const handleConnectRepoClick = () => {
    if (interactive) {
      setShowDropdownState(!showDropdownState);
    }
  };

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
      {/* Main Heading */}
      <div
        style={{
          color: "#ffffff",
          fontSize: 29,
          fontFamily: "Inter, sans-serif",
          fontWeight: 600,
          lineHeight: 1.33,
          textAlign: "center",
        }}
      >
        What should we build?
      </div>

      {/* Main Card */}
      <div
        style={{
          borderRadius: 10,
          backgroundColor: "#292929",
          display: "flex",
          flexDirection: "column",
          marginTop: 30,
          outline: isFocused ? "1px solid #48A1FF" : "none",
          transition: "outline 0.15s ease",
        }}
      >
        {/* Ask Builder Input */}
        <div
          style={{
            display: "flex",
            minHeight: 100,
            padding: 18,
            paddingBottom: 61,
            alignItems: "start",
            gap: 20,
            fontSize: 17,
            fontFamily: "Inter, sans-serif",
            color: "#999999",
            fontWeight: 400,
            lineHeight: 1.29,
            position: "relative",
          }}
        >
          {interactive ? (
            <textarea
              value={value}
              onChange={(e) => onChange?.(e.target.value)}
              onFocus={() => setIsFocusedState(true)}
              onBlur={() => setIsFocusedState(false)}
              placeholder="Ask Builder"
              style={{
                width: "100%",
                minHeight: 40,
                backgroundColor: "transparent",
                border: "none",
                outline: "none",
                color: value ? "#ffffff" : "#999999",
                fontSize: 17,
                fontFamily: "Inter, sans-serif",
                fontWeight: 400,
                lineHeight: 1.29,
                resize: "none",
                padding: 0,
              }}
              className="placeholder:text-[#999999]"
            />
          ) : value ? (
            <span style={{ color: "#ffffff" }}>
              {value}
              {showTypingCursor && typingCursorBlink && (
                <span style={{ opacity: 0.8 }}>|</span>
              )}
            </span>
          ) : (
            "Ask Builder"
          )}
        </div>

        {/* Controls Row */}
        <div
          style={{
            display: "flex",
            minHeight: 54,
            padding: "11px 16px",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 24,
          }}
        >
          {/* Left Side - Framework Selector */}
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            {/* Command Button */}
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div
                style={{
                  borderRadius: 7,
                  borderColor: "#393939",
                  borderStyle: "solid",
                  borderWidth: 1,
                  width: 30,
                  height: 30,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  backgroundColor: cogButtonIsHovered ? "rgba(255, 255, 255, 0.1)" : "transparent",
                  transition: "background-color 0.15s ease",
                }}
              >
                <img
                  src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/4c3b750c19604cb590cdde4cb23239027701b544?placeholderIfAbsent=true"
                  alt=""
                  style={{
                    width: 19,
                    aspectRatio: 1.07,
                    objectFit: "contain",
                  }}
                />
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  fontSize: 16,
                  fontFamily: "Inter, sans-serif",
                  color: "#a4a4a4",
                  fontWeight: 500,
                  cursor: "pointer",
                  padding: "6px 8px",
                  borderRadius: 5,
                  backgroundColor: reactViteIsHovered ? "rgba(255, 255, 255, 0.1)" : "transparent",
                  transition: "background-color 0.15s ease",
                  marginLeft: -8,
                }}
              >
                <span>React + Vite</span>
                <img
                  src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/b652d4f9c47c0c2808a761d0c3617bc0ed1894a9?placeholderIfAbsent=true"
                  alt=""
                  style={{
                    width: 17,
                    aspectRatio: 1.08,
                    objectFit: "contain",
                  }}
                />
              </div>
            </div>
          </div>

          {/* Right Side - Build Controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
            {/* 1 x */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontSize: 16,
                fontFamily: "Inter, sans-serif",
                color: "#a4a4a4",
                fontWeight: 500,
                letterSpacing: "-1.16px",
                cursor: "pointer",
                padding: "6px 8px",
                borderRadius: 5,
                backgroundColor: oneXIsHovered ? "rgba(255, 255, 255, 0.1)" : "transparent",
                transition: "background-color 0.15s ease",
                marginLeft: -8,
              }}
            >
              <span>1 x</span>
              <img
                src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/e808b07ef5be12868441a4a03cb861395dd738ce?placeholderIfAbsent=true"
                alt=""
                style={{ width: 17, aspectRatio: 1.08, objectFit: "contain" }}
              />
            </div>

            {/* Build */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 16,
                fontFamily: "Inter, sans-serif",
                color: "#a4a4a4",
                fontWeight: 500,
                cursor: "pointer",
                padding: "6px 8px",
                borderRadius: 5,
                backgroundColor: buildButtonIsHovered ? "rgba(255, 255, 255, 0.1)" : "transparent",
                transition: "background-color 0.15s ease",
                marginLeft: -8,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                <img
                  src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/d650eb75d01f1f4846ec76d006b0954978a6f2ea?placeholderIfAbsent=true"
                  alt=""
                  style={{
                    width: 22,
                    aspectRatio: 1.06,
                    objectFit: "contain",
                  }}
                />
                <span>Build</span>
              </div>
              <img
                src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/e808b07ef5be12868441a4a03cb861395dd738ce?placeholderIfAbsent=true"
                alt=""
                style={{ width: 16, aspectRatio: 1, objectFit: "contain" }}
              />
            </div>

            {/* Send Button */}
            <div
              onClick={() => {
                if (interactive && onSend) {
                  onSend();
                }
              }}
              style={{
                position: "relative",
                borderRadius: 5,
                backgroundColor: hasText ? "#48A1FF" : "#666666",
                width: 29,
                height: 29,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                transform: isClicking ? "scale(0.9)" : `scale(${1 + hoverProgress * 0.1})`,
                filter: hasText && isHovered ? "brightness(1.15)" : "brightness(1)",
                transition: "transform 0.1s ease, filter 0.15s ease",
              }}
            >
              <img
                src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/58080c3f8912ee73cbce06070241ac542b757b7d?placeholderIfAbsent=true"
                alt=""
                style={{
                  width: 22,
                  aspectRatio: 1,
                  objectFit: "contain",
                  filter: hasText ? "invert(1)" : "none"
                }}
              />
              {/* Hover overlay */}
              {isHovered && !hasText && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    borderRadius: 5,
                    backgroundColor: "rgba(122, 122, 122, 0.5)",
                    pointerEvents: "none",
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Action Buttons Row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginTop: 30,
          justifyContent: "center",
        }}
      >
        {/* Connect Repo Button */}
        <div style={{ display: "flex", position: "relative" }}>
          <div
            onClick={handleConnectRepoClick}
            style={{
              borderRadius: "5px 0px 0px 5px",
              backgroundColor: "#48a1ff",
              display: "flex",
              padding: "11px 14px",
              alignItems: "center",
              gap: 10,
              fontSize: 19,
              fontFamily: "Inter, sans-serif",
              color: "#000000",
              fontWeight: 500,
              cursor: "pointer",
              filter: connectRepoIsHovered ? "brightness(1.15)" : "brightness(1)",
              transition: "filter 0.15s ease",
            }}
          >
            <img
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/5738c2d7607cb731caeaa8379b5782bc4125dfa6?placeholderIfAbsent=true"
              alt=""
              style={{ width: 24, aspectRatio: 1, objectFit: "contain" }}
            />
            <span>Connect Repo</span>
          </div>
          <div
            onClick={handleConnectRepoClick}
            style={{
              borderRadius: "0px 5px 5px 0px",
              backgroundColor: "#48a1ff",
              display: "flex",
              padding: 8,
              minHeight: 46,
              width: 36,
              alignItems: "center",
              justifyContent: "center",
              borderLeft: "1px solid rgba(0, 0, 0, 0.15)",
              filter: connectRepoIsHovered ? "brightness(1.15)" : "brightness(1)",
              transition: "filter 0.15s ease",
              cursor: "pointer",
            }}
          >
            <img
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/42952c4ea7909087b688d7e28be374817ed583e7?placeholderIfAbsent=true"
              alt=""
              style={{ width: 14, aspectRatio: 2, objectFit: "contain" }}
            />
          </div>
        </div>

        {/* Template Icon 1 */}
        <div
          style={{
            borderRadius: 7,
            backgroundColor: "#2a2a2a",
            borderColor: "#393939",
            borderStyle: "solid",
            borderWidth: 1,
            width: 59,
            height: 49,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            filter: template1IsHovered ? "brightness(1.3)" : "brightness(1)",
            transition: "filter 0.15s ease",
          }}
        >
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/246cc6f7ade4946a2a49e931a40a2d29f384c0c8?placeholderIfAbsent=true"
            alt=""
            style={{ width: 24, aspectRatio: 1, objectFit: "contain" }}
          />
        </div>

        {/* Template Icon 2 */}
        <div
          style={{
            borderRadius: 7,
            backgroundColor: "#2a2a2a",
            borderColor: "#393939",
            borderStyle: "solid",
            borderWidth: 1,
            width: 59,
            height: 49,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            filter: template2IsHovered ? "brightness(1.3)" : "brightness(1)",
            transition: "filter 0.15s ease",
          }}
        >
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/70bd42ab9a802364fbdfa617dc990b26382a2264?placeholderIfAbsent=true"
            alt=""
            style={{ width: 24, aspectRatio: 1, objectFit: "contain" }}
          />
        </div>

        {/* More Button */}
        <div
          style={{
            borderRadius: 7,
            backgroundColor: "#2a2a2a",
            borderColor: "#393939",
            borderStyle: "solid",
            borderWidth: 1,
            width: 102,
            height: 49,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            fontSize: 19,
            fontFamily: "Inter, sans-serif",
            color: "#ffffff",
            fontWeight: 500,
            cursor: "pointer",
            filter: moreButtonIsHovered ? "brightness(1.3)" : "brightness(1)",
            transition: "filter 0.15s ease",
          }}
        >
          <span>More</span>
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/8e43ec58a8a65f11849642354fec699114242e4d?placeholderIfAbsent=true"
            alt=""
            style={{ width: 19, aspectRatio: 1, objectFit: "contain" }}
          />
        </div>
      </div>

      {/* Git Providers Dropdown */}
      {showDropdown && (
        <GitProvidersDropdown
          isOpen={showDropdown}
          opacity={dropdownOpacity}
          x={dropdownXProp ?? 0}
          y={dropdownYProp ?? (useAbsolutePosition ? 296 : 250)}
          onSelectProvider={(provider) => {
            onSelectProvider?.(provider);
            if (interactive) {
              setShowDropdownState(false);
            }
          }}
          githubProviderIsHovered={githubProviderIsHovered}
          azureProviderIsHovered={azureProviderIsHovered}
          gitlabProviderIsHovered={gitlabProviderIsHovered}
          bitbucketProviderIsHovered={bitbucketProviderIsHovered}
        />
      )}

      {/* Zone Editor - only visible in debug mode */}
      <ZoneEditor />
    </div>
  );
};

// Note: This component can be used directly in compositions or interactive pages
// For a preview, import and use it in your composition with createInteractiveComposition
