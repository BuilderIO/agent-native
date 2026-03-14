/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PROJECTS INTERACTIVE COMPOSITION
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Interactive showcase of the Projects Screen layout with cursor animations:
 * 1. Projects screen fades up and in
 * 2. Mouse clicks on "Ask Builder" input
 * 3. Types a prompt character by character
 * 4. Clicks the send button
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { AnimationTrack } from "@/types";
import { findTrack, trackProgress, getPropValue } from "../trackAnimation";
import { createInteractiveComposition } from "../hooks/createInteractiveComposition";
import { useInteractiveComponent, AnimationPresets } from "../hooks/useInteractiveComponent";
import { ProjectsLayout } from "../library-components/ProjectsLayout";
import type { Zone } from "../hooks/useEditableZones";

export type ProjectsInteractiveProps = {
  prompt?: string;
  tracks?: AnimationTrack[];
};

const FALLBACK_TRACKS: AnimationTrack[] = [
  {
    id: "screen-entrance",
    label: "Screen Entrance",
    startFrame: 0,
    endFrame: 50,
    easing: "power2.out",
    animatedProps: [
      { property: "opacity", from: "0", to: "1", unit: "" },
      { property: "translateY", from: "40", to: "0", unit: "px" },
    ],
  },
  {
    id: "cursor",
    label: "Cursor",
    startFrame: 0,
    endFrame: 300,
    easing: "linear",
    animatedProps: [
      { property: "x", from: "200", to: "960", unit: "px" },
      { property: "y", from: "100", to: "540", unit: "px" },
      { property: "opacity", from: "0", to: "1", unit: "" },
      { property: "isClicking", from: "0", to: "0", unit: "" },
    ],
  },
  {
    id: "placeholder-hide",
    label: "Placeholder Hide",
    startFrame: 95,
    endFrame: 95,
    easing: "linear",
    animatedProps: [
      { property: "hide", from: "", to: "", unit: "", programmatic: true }
    ],
  },
  {
    id: "typing-reveal",
    label: "Typing Reveal",
    startFrame: 100,
    endFrame: 200,
    easing: "linear",
    animatedProps: [
      {
        property: "charsVisible",
        from: "0",
        to: "1",
        unit: "",
        programmatic: true,
        description: "Characters appear one by one as if being typed",
      },
    ],
  },
  {
    id: "typed-text-hide",
    label: "Typed Text Hide",
    startFrame: 300,
    endFrame: 300,
    easing: "linear",
    animatedProps: [
      { property: "hide", from: "", to: "", unit: "", programmatic: true }
    ],
  },
  {
    id: "dropdown-show",
    label: "Dropdown Show",
    startFrame: 268,
    endFrame: 268,
    easing: "linear",
    animatedProps: [
      { property: "show", from: "", to: "", unit: "", programmatic: true }
    ],
  },
  {
    id: "dropdown-hide",
    label: "Dropdown Hide",
    startFrame: 338,
    endFrame: 338,
    easing: "linear",
    animatedProps: [
      { property: "hide", from: "", to: "", unit: "", programmatic: true }
    ],
  },
];

export const ProjectsInteractive = createInteractiveComposition<ProjectsInteractiveProps>({
  fallbackTracks: FALLBACK_TRACKS,

  render: ({ cursorHistory, tracks: originalTracks, registerForCursor }, props) => {
    const { prompt = "Create a modern landing page with hero section and pricing cards" } = props;
    const frame = useCurrentFrame();
    const { fps, width, height } = useVideoConfig();

    const tracks = originalTracks;

    // Find tracks
    const entranceTrack = findTrack(tracks, "screen-entrance", FALLBACK_TRACKS[0]);
    const cursorTrack = findTrack(tracks, "cursor", FALLBACK_TRACKS[1]);
    const placeholderHideTrack = findTrack(tracks, "placeholder-hide", FALLBACK_TRACKS[2]);
    const typingTrack = findTrack(tracks, "typing-reveal", FALLBACK_TRACKS[3]);
    const typedTextHideTrack = findTrack(tracks, "typed-text-hide", FALLBACK_TRACKS[4]);
    const dropdownShowTrack = findTrack(tracks, "dropdown-show", FALLBACK_TRACKS[5]);
    const dropdownHideTrack = findTrack(tracks, "dropdown-hide", FALLBACK_TRACKS[6]);

    // Entrance animation
    const entranceP = trackProgress(frame, fps, entranceTrack);
    const entranceOpacity = getPropValue(entranceP, entranceTrack, "opacity", 0, 1);
    const entranceY = getPropValue(entranceP, entranceTrack, "translateY", 40, 0);

    // Cursor position (cursor is hidden in debug mode via track modification)
    const cursorP = trackProgress(frame, fps, cursorTrack);
    const cursorX = getPropValue(cursorP, cursorTrack, "x", 200, 960);
    const cursorY = getPropValue(cursorP, cursorTrack, "y", 100, 540);
    const cursorOpacity = getPropValue(cursorP, cursorTrack, "opacity", 0, 1);

    // Placeholder hide overlay (single keyframe event at frame 95)
    const shouldHidePlaceholder = frame >= placeholderHideTrack.startFrame;

    // Typing reveal
    const typingP = trackProgress(frame, fps, typingTrack);
    const charsToShow = Math.floor(typingP * prompt.length);
    const visiblePrompt = prompt.slice(0, charsToShow);

    // Typed text visibility - show during typing and after until hide keyframe
    const isTyping = frame >= typingTrack.startFrame && frame <= typingTrack.endFrame;
    const typingCursorBlink = Math.floor(frame / 15) % 2 === 0;
    const shouldShowTypedText = frame >= typingTrack.startFrame && frame < typedTextHideTrack.startFrame;

    // Input is focused from when placeholder hides until text is cleared
    const promptIsFocused = frame >= placeholderHideTrack.startFrame && frame < typedTextHideTrack.startFrame;

    // Layout calculations for positioning
    // Layout: 100px outer padding, 73px sidebar, 83px screen padding
    // CreateProjectPrompt is 790px wide, centered in content area
    const outerPadding = 100;
    const sidebarWidth = 73;
    const screenPadding = 83;
    const promptWidth = 790;
    const contentWidth = (width - outerPadding * 2) - sidebarWidth - screenPadding * 2;
    const promptXInContent = (contentWidth - promptWidth) / 2;
    const promptX = outerPadding + sidebarWidth + screenPadding + promptXInContent;
    const promptY = outerPadding + 67; // ProjectsScreen top padding

    // Zones for cursor detection (absolute coordinates)
    // These coordinates were perfected using debug mode in Component Library view (790px width)
    const zones = {
      Input: { x: 604, y: 238, width: 654, height: 98 },
      Cog: { x: 619, y: 372, width: 30, height: 30 },
      React: { x: 655, y: 374, width: 130, height: 30 },
      '1x': { x: 1156, y: 374, width: 55, height: 30 },
      Build: { x: 1224, y: 373, width: 102, height: 30 },
      Send: { x: 1346, y: 376, width: 29, height: 29 },
    };

    // Interactive components for cursor detection
    const inputField = useInteractiveComponent({
      id: "ask-builder-input",
      elementType: "Input",
      label: "Ask Builder Input",
      compositionId: "projects-interactive",
      zone: zones.Input,
      cursorHistory,
      interactiveElementType: "input",
      hoverAnimation: AnimationPresets.scaleHover(0),
    });

    const cogButton = useInteractiveComponent({
      id: "cog-button",
      elementType: "Button",
      label: "Cog Button",
      compositionId: "projects-interactive",
      zone: zones.Cog,
      cursorHistory,
      interactiveElementType: "button",
      hoverAnimation: AnimationPresets.scaleHover(0),
    });

    const reactViteButton = useInteractiveComponent({
      id: "react-vite-button",
      elementType: "Button",
      label: "React + Vite Button",
      compositionId: "projects-interactive",
      zone: zones.React,
      cursorHistory,
      interactiveElementType: "button",
      hoverAnimation: AnimationPresets.scaleHover(0),
    });

    const oneXButton = useInteractiveComponent({
      id: "one-x-button",
      elementType: "Button",
      label: "1x Button",
      compositionId: "projects-interactive",
      zone: zones['1x'],
      cursorHistory,
      interactiveElementType: "button",
      hoverAnimation: AnimationPresets.scaleHover(0),
    });

    const buildButton = useInteractiveComponent({
      id: "build-button",
      elementType: "Button",
      label: "Build Button",
      compositionId: "projects-interactive",
      zone: zones.Build,
      cursorHistory,
      interactiveElementType: "button",
      hoverAnimation: AnimationPresets.scaleHover(0),
    });

    const sendButton = useInteractiveComponent({
      id: "send-button",
      elementType: "Button",
      label: "Send Button",
      compositionId: "projects-interactive",
      zone: zones.Send,
      cursorHistory,
      interactiveElementType: "button",
      hoverAnimation: AnimationPresets.scaleHover(0.1),
    });

    // Action buttons below the card
    // Card height: 154px (100px input + 54px controls), marginTop: 30
    const actionButtonsY = promptY + 39 + 30 + 154 + 30; // Heading + margin + card + margin

    // Action buttons are centered: Connect Repo (182px), gap (8px), Template1 (59px), gap (8px), Template2 (59px), gap (8px), More (102px)
    const actionButtonsWidth = 182 + 8 + 59 + 8 + 59 + 8 + 102;
    const actionButtonsStartX = promptX + (promptWidth - actionButtonsWidth) / 2;

    const connectRepoButton = useInteractiveComponent({
      id: "connect-repo-button",
      elementType: "Button",
      label: "Connect Repo Button",
      compositionId: "projects-interactive",
      zone: { x: actionButtonsStartX, y: actionButtonsY, width: 182, height: 46 },
      cursorHistory,
      interactiveElementType: "button",
      hoverAnimation: AnimationPresets.scaleHover(0),
    });

    const template1Button = useInteractiveComponent({
      id: "template1-button",
      elementType: "Button",
      label: "Template 1 Button",
      compositionId: "projects-interactive",
      zone: { x: actionButtonsStartX + 182 + 8, y: actionButtonsY, width: 59, height: 49 },
      cursorHistory,
      interactiveElementType: "button",
      hoverAnimation: AnimationPresets.scaleHover(0),
    });

    const template2Button = useInteractiveComponent({
      id: "template2-button",
      elementType: "Button",
      label: "Template 2 Button",
      compositionId: "projects-interactive",
      zone: { x: actionButtonsStartX + 182 + 8 + 59 + 8, y: actionButtonsY, width: 59, height: 49 },
      cursorHistory,
      interactiveElementType: "button",
      hoverAnimation: AnimationPresets.scaleHover(0),
    });

    const moreButton = useInteractiveComponent({
      id: "more-button",
      elementType: "Button",
      label: "More Button",
      compositionId: "projects-interactive",
      zone: { x: actionButtonsStartX + 182 + 8 + 59 + 8 + 59 + 8, y: actionButtonsY, width: 102, height: 49 },
      cursorHistory,
      interactiveElementType: "button",
      hoverAnimation: AnimationPresets.scaleHover(0),
    });

    // Dropdown visibility - controlled by timeline tracks
    // Show after Connect Repo button is clicked, hide after provider is clicked
    const showDropdown = frame >= dropdownShowTrack.startFrame && frame < dropdownHideTrack.startFrame;

    // Calculate dropdown position relative to CreateProjectPrompt component
    // CreateProjectPrompt layout: heading (39px) + margin (30px) + card (154px) + margin (30px) + buttons
    // Buttons are at Y = 253px relative to CreateProjectPrompt
    // Button height is 46px, add 18px gap
    const dropdownRelativeY = 39 + 30 + 154 + 30 + 46 + 18; // = 317px

    // Dropdown should align with left edge of Connect Repo button
    // Action buttons are centered, so calculate X relative to CreateProjectPrompt (which is 790px wide)
    // Offset 10px to the left
    const dropdownRelativeX = (promptWidth - actionButtonsWidth) / 2 - 10;

    // Calculate absolute dropdown position for interactive zones
    const dropdownAbsoluteX = promptX + dropdownRelativeX;
    const dropdownAbsoluteY = promptY + dropdownRelativeY;

    // Dropdown item zones (only active when dropdown is visible)
    // Dropdown structure: 24px padding, 16px top, header ~21px, 19px margin, then items
    // Each item is ~35px tall with 13px gap
    // Items have marginLeft: -10px, padding: 5px 10px
    // Zone starts at: dropdownAbsoluteX + 24 - 10 = dropdownAbsoluteX + 14
    // Zone should extend all the way to the right edge including the padding area
    // Making it wide enough to definitely reach the right edge
    const dropdownItemWidth = 400;
    const dropdownItemHeight = 35;
    const githubItem = useInteractiveComponent({
      id: "github-provider",
      elementType: "Button",
      label: "GitHub Provider",
      compositionId: "projects-interactive",
      zone: {
        x: dropdownAbsoluteX + 24 - 10, // Account for negative margin
        y: dropdownAbsoluteY + 16 + 21 + 19,
        width: dropdownItemWidth,
        height: dropdownItemHeight
      },
      cursorHistory,
      interactiveElementType: "button",
      hoverAnimation: AnimationPresets.scaleHover(0),
    });

    const azureItem = useInteractiveComponent({
      id: "azure-provider",
      elementType: "Button",
      label: "Azure DevOps Provider",
      compositionId: "projects-interactive",
      zone: {
        x: dropdownAbsoluteX + 24 - 10, // Account for negative margin
        y: dropdownAbsoluteY + 16 + 21 + 19 + 35 + 13,
        width: dropdownItemWidth,
        height: dropdownItemHeight
      },
      cursorHistory,
      interactiveElementType: "button",
      hoverAnimation: AnimationPresets.scaleHover(0),
    });

    const gitlabItem = useInteractiveComponent({
      id: "gitlab-provider",
      elementType: "Button",
      label: "GitLab Provider",
      compositionId: "projects-interactive",
      zone: {
        x: dropdownAbsoluteX + 24 - 10, // Account for negative margin
        y: dropdownAbsoluteY + 16 + 21 + 19 + 35 + 13 + 35 + 13,
        width: dropdownItemWidth,
        height: dropdownItemHeight
      },
      cursorHistory,
      interactiveElementType: "button",
      hoverAnimation: AnimationPresets.scaleHover(0),
    });

    const bitbucketItem = useInteractiveComponent({
      id: "bitbucket-provider",
      elementType: "Button",
      label: "Bitbucket Provider",
      compositionId: "projects-interactive",
      zone: {
        x: dropdownAbsoluteX + 24 - 10, // Account for negative margin
        y: dropdownAbsoluteY + 16 + 21 + 19 + 35 + 13 + 35 + 13 + 35 + 13,
        width: dropdownItemWidth,
        height: dropdownItemHeight
      },
      cursorHistory,
      interactiveElementType: "button",
      hoverAnimation: AnimationPresets.scaleHover(0),
    });

    // Register for cursor
    registerForCursor(inputField);
    registerForCursor(cogButton);
    registerForCursor(reactViteButton);
    registerForCursor(oneXButton);
    registerForCursor(buildButton);
    registerForCursor(sendButton);
    registerForCursor(connectRepoButton);
    registerForCursor(template1Button);
    registerForCursor(template2Button);
    registerForCursor(moreButton);
    if (showDropdown) {
      registerForCursor(githubItem);
      registerForCursor(azureItem);
      registerForCursor(gitlabItem);
      registerForCursor(bitbucketItem);
    }

    return (
      <AbsoluteFill style={{ backgroundColor: "#0a0a0a" }}>
        {/* Projects Layout with entrance animation */}
        <div
          style={{
            position: "absolute",
            width: "100%",
            height: "100%",
            opacity: entranceOpacity,
            transform: `translateY(${entranceY}px)`,
          }}
        >
          <ProjectsLayout
            x={0}
            y={0}
            width={width}
            height={height}
            promptHasText={shouldShowTypedText}
            promptValue={shouldShowTypedText ? (isTyping ? visiblePrompt : prompt) : ""}
            promptIsFocused={promptIsFocused}
            showTypingCursor={isTyping}
            typingCursorBlink={typingCursorBlink}
            cogButtonIsHovered={cogButton.hover.isHovering}
            reactViteIsHovered={reactViteButton.hover.isHovering}
            oneXIsHovered={oneXButton.hover.isHovering}
            buildButtonIsHovered={buildButton.hover.isHovering}
            sendButtonIsHovered={sendButton.hover.isHovering}
            sendButtonHoverProgress={sendButton.combinedProgress}
            sendButtonIsClicking={sendButton.click.isClicking}
            connectRepoIsHovered={connectRepoButton.hover.isHovering}
            template1IsHovered={template1Button.hover.isHovering}
            template2IsHovered={template2Button.hover.isHovering}
            moreButtonIsHovered={moreButton.hover.isHovering}
            showDropdown={showDropdown}
            dropdownX={dropdownRelativeX}
            dropdownY={dropdownRelativeY}
            githubProviderIsHovered={showDropdown && githubItem.hover.isHovering}
            azureProviderIsHovered={showDropdown && azureItem.hover.isHovering}
            gitlabProviderIsHovered={showDropdown && gitlabItem.hover.isHovering}
            bitbucketProviderIsHovered={showDropdown && bitbucketItem.hover.isHovering}
          />
        </div>
      </AbsoluteFill>
    );
  },
});
