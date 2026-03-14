/**
 * ═══════════════════════════════════════════════════════════════════════════
 * STANDARD VIEW LAYOUT ORGANISM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The standard 3-column layout for the workspace.
 * Combines sidebar, agent panel, and app preview.
 *
 * Features:
 * - Left sidebar with navigation (61px)
 * - Middle agent/chat panel (340px)
 * - Right app preview area (flexible width)
 * - Full dark theme layout
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import type { AnimationTrack } from "@/types";
import { findTrack, trackProgress, getPropValue } from "../trackAnimation";
import { AgentPanel } from "./AgentPanel";
import { AppPreviewHeader } from "./AppPreviewHeader";
import { ReviewPR } from "@/components/ReviewPR";
import { BranchCard } from "./BranchCard";

export type StandardViewProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  tracks?: AnimationTrack[];
  branchName?: string;
  projectName?: string;
  url?: string;
};

export const StandardView: React.FC<StandardViewProps> = (props) => {
  const {
    x = 0,
    y = 0,
    width = 1920,
    height = 1080,
    tracks = [],
    branchName = "branch-name",
    projectName = "videos",
    url = "localhost:8000",
  } = props;

  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Calculate global frame (Scene 3 starts at frame 336)
  const globalFrame = frame + 336;

  // Padding around the composition
  const padding = 100;
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;

  // Alex cursor animation
  const alexCursorTrack = findTrack(tracks, "alex-cursor-move", {
    id: "alex-cursor-move",
    label: "Alex Cursor Move",
    startFrame: 400,
    endFrame: 420,
    easing: "expo.inOut",
    animatedProps: [
      { property: "x", from: "20", to: "57", unit: "%", keyframes: [] },
      { property: "y", from: "60", to: "32", unit: "%", keyframes: [] },
    ],
  });
  const alexCursorProgress = trackProgress(globalFrame, fps, alexCursorTrack);
  const alexCursorX = getPropValue(
    alexCursorProgress,
    alexCursorTrack,
    "x",
    20,
    57,
  );
  const alexCursorY = getPropValue(
    alexCursorProgress,
    alexCursorTrack,
    "y",
    60,
    32,
  );

  // Alex cursor click animation (manual calculation for down-up motion)
  const alexCursorScale =
    globalFrame < 419
      ? 1
      : globalFrame < 421
        ? 1 - ((globalFrame - 419) / 2) * 0.15 // Scale down to 0.85
        : globalFrame < 424
          ? 0.85 + ((globalFrame - 421) / 3) * 0.15 // Scale back up to 1
          : 1;

  // Data click animation
  const dataClickTrack = findTrack(tracks, "data-click", {
    id: "data-click",
    label: "Data Click",
    startFrame: 420,
    endFrame: 425,
    easing: "linear",
    animatedProps: [
      { property: "outline", from: "0", to: "1", unit: "", keyframes: [] },
    ],
  });
  const dataClickProgress = trackProgress(globalFrame, fps, dataClickTrack);
  const dataOutline = getPropValue(
    dataClickProgress,
    dataClickTrack,
    "outline",
    0,
    1,
  );

  // Chart transform animation
  const chartTransformTrack = findTrack(tracks, "chart-transform", {
    id: "chart-transform",
    label: "Chart Transform",
    startFrame: 435,
    endFrame: 460,
    easing: "power2.inOut",
    animatedProps: [
      { property: "progress", from: "0", to: "1", unit: "", keyframes: [] },
    ],
  });
  const chartTransformProgress = trackProgress(
    globalFrame,
    fps,
    chartTransformTrack,
  );
  const chartProgress = getPropValue(
    chartTransformProgress,
    chartTransformTrack,
    "progress",
    0,
    1,
  );

  // Cursor fade-out at frame 500
  const cursorFadeStart = 500;
  const cursorFadeEnd = 515;
  const cursorOpacity =
    globalFrame < cursorFadeStart
      ? 1
      : globalFrame < cursorFadeEnd
        ? 1 -
          (globalFrame - cursorFadeStart) / (cursorFadeEnd - cursorFadeStart)
        : 0;

  // De-highlight chart at frame 500
  const shouldHighlightChart = globalFrame >= 420 && globalFrame < 500;

  // Cursor movement animations (frames 410-500)
  const getCursorMovement = (
    baseX: number,
    baseY: number,
    offsetX: number,
    offsetY: number,
    phase: number,
  ) => {
    if (globalFrame < 410) return { x: baseX, y: baseY };

    const progress = (globalFrame - 410) / 90; // 90 frames of movement (410-500)
    const wave1 = Math.sin(progress * Math.PI * 0.8 + phase) * offsetX; // Slower wave (0.8 cycles instead of 3)
    const wave2 = Math.cos(progress * Math.PI * 0.6 + phase) * offsetY; // Slower wave (0.6 cycles instead of 2.5)

    return {
      x: baseX + wave1,
      y: baseY + wave2,
    };
  };

  // Yellow cursor movement - larger offsets for more movement
  const yellowCursor = getCursorMovement(20, 30, 15, 12, 0);

  // Purple cursor movement - larger offsets
  const purpleCursor = getCursorMovement(50, 45, 12, 15, 1.5);

  // Orange cursor movement - larger offsets
  const orangeCursor = getCursorMovement(35, 60, 14, 13, 3);

  // Ask Builder typing animation
  const typingTrack = findTrack(tracks, "ask-builder-typing", {
    id: "ask-builder-typing",
    label: "Ask Builder Typing",
    startFrame: 518,
    endFrame: 558,
    easing: "linear",
    animatedProps: [
      { property: "progress", from: "0", to: "1", unit: "", keyframes: [] },
    ],
  });
  const typingTrackProgress = trackProgress(globalFrame, fps, typingTrack);
  const typingProgress = getPropValue(
    typingTrackProgress,
    typingTrack,
    "progress",
    0,
    1,
  );

  // Component menu animation
  const menuTrack = findTrack(tracks, "component-menu", {
    id: "component-menu",
    label: "Component Menu Appear",
    startFrame: 525,
    endFrame: 530,
    easing: "power2.out",
    animatedProps: [
      { property: "opacity", from: "0", to: "1", unit: "", keyframes: [] },
      { property: "y", from: "10", to: "0", unit: "px", keyframes: [] },
    ],
  });
  const menuTrackProgress = trackProgress(globalFrame, fps, menuTrack);
  const menuOpacity = getPropValue(
    menuTrackProgress,
    menuTrack,
    "opacity",
    0,
    1,
  );
  const menuY = getPropValue(menuTrackProgress, menuTrack, "y", 10, 0);

  // Menu selection animation
  const selectionTrack = findTrack(tracks, "menu-selection", {
    id: "menu-selection",
    label: "Menu Item Selection",
    startFrame: 540,
    endFrame: 545,
    easing: "power2.out",
    animatedProps: [
      { property: "progress", from: "0", to: "1", unit: "", keyframes: [] },
    ],
  });
  const selectionTrackProgress = trackProgress(
    globalFrame,
    fps,
    selectionTrack,
  );
  const menuSelectionProgress = getPropValue(
    selectionTrackProgress,
    selectionTrack,
    "progress",
    0,
    1,
  );

  // Send message animation
  const sendTrack = findTrack(tracks, "send-message", {
    id: "send-message",
    label: "Send Message Animation",
    startFrame: 576,
    endFrame: 581,
    easing: "power2.out",
    animatedProps: [
      { property: "progress", from: "0", to: "1", unit: "", keyframes: [] },
    ],
  });
  const sendTrackProgress = trackProgress(globalFrame, fps, sendTrack);
  const sendMessageProgress = getPropValue(
    sendTrackProgress,
    sendTrack,
    "progress",
    0,
    1,
  );

  // Mention hint message animation
  const mentionHintTrack = findTrack(tracks, "mention-hint", {
    id: "mention-hint",
    label: "Mention Hint Message",
    startFrame: 580,
    endFrame: 600,
    easing: "spring",
    animatedProps: [
      { property: "opacity", from: "0", to: "1", unit: "", keyframes: [] },
      { property: "y", from: "80", to: "0", unit: "px", keyframes: [] },
      { property: "scale", from: "0.9", to: "1", unit: "", keyframes: [] },
    ],
  });
  const mentionHintTrackProgress = trackProgress(
    globalFrame,
    fps,
    mentionHintTrack,
  );
  const mentionHintOpacity = getPropValue(
    mentionHintTrackProgress,
    mentionHintTrack,
    "opacity",
    0,
    1,
  );
  const mentionHintY = getPropValue(
    mentionHintTrackProgress,
    mentionHintTrack,
    "y",
    80,
    0,
  );
  const mentionHintScale = getPropValue(
    mentionHintTrackProgress,
    mentionHintTrack,
    "scale",
    0.9,
    1,
  );

  // Review PR panel animation
  const reviewPRTrack = findTrack(tracks, "review-pr-panel", {
    id: "review-pr-panel",
    label: "Review PR Panel",
    startFrame: 690,
    endFrame: 710,
    easing: "spring",
    animatedProps: [
      { property: "opacity", from: "0", to: "1", unit: "", keyframes: [] },
      { property: "y", from: "-20", to: "0", unit: "px", keyframes: [] },
      { property: "scale", from: "0.95", to: "1", unit: "", keyframes: [] },
    ],
  });
  const reviewPRTrackProgress = trackProgress(globalFrame, fps, reviewPRTrack);
  const reviewPROpacity = getPropValue(
    reviewPRTrackProgress,
    reviewPRTrack,
    "opacity",
    0,
    1,
  );
  const reviewPRY = getPropValue(
    reviewPRTrackProgress,
    reviewPRTrack,
    "y",
    -20,
    0,
  );
  const reviewPRScale = getPropValue(
    reviewPRTrackProgress,
    reviewPRTrack,
    "scale",
    0.95,
    1,
  );

  // "Get your changes reviewed" typing animation at frame 720
  const reviewTypingTrack = findTrack(tracks, "review-typing", {
    id: "review-typing",
    label: "Get Your Changes Reviewed Typing",
    startFrame: 720,
    endFrame: 780,
    easing: "linear",
    animatedProps: [
      { property: "progress", from: "0", to: "1", unit: "", keyframes: [] },
    ],
  });
  const reviewTypingTrackProgress = trackProgress(
    globalFrame,
    fps,
    reviewTypingTrack,
  );
  const reviewTypingProgress = getPropValue(
    reviewTypingTrackProgress,
    reviewTypingTrack,
    "progress",
    0,
    1,
  );

  // Typing animation for "Get your changes reviewed"
  const reviewTypingText = "Get your changes reviewed";
  const reviewCharsToShow = Math.floor(
    reviewTypingProgress * reviewTypingText.length,
  );
  const reviewVisibleText = reviewTypingText.slice(0, reviewCharsToShow);

  // "Manage a fleet of agents" typing animation at frame 1010
  const fleetTypingTrack = findTrack(tracks, "fleet-typing", {
    id: "fleet-typing",
    label: "Manage a Fleet of Agents Typing",
    startFrame: 1010,
    endFrame: 1070,
    easing: "linear",
    animatedProps: [
      { property: "progress", from: "0", to: "1", unit: "", keyframes: [] },
    ],
  });
  const fleetTypingTrackProgress = trackProgress(
    globalFrame,
    fps,
    fleetTypingTrack,
  );
  const fleetTypingProgress = getPropValue(
    fleetTypingTrackProgress,
    fleetTypingTrack,
    "progress",
    0,
    1,
  );

  // Typing animation for "Manage a fleet of agents"
  const fleetTypingText = "Manage a fleet of agents";
  const fleetCharsToShow = Math.floor(
    fleetTypingProgress * fleetTypingText.length,
  );
  const fleetVisibleText = fleetTypingText.slice(0, fleetCharsToShow);

  // Split-screen animation (after frame 780)
  const splitScreenTrack1 = findTrack(tracks, "split-screen-1to2", {
    id: "split-screen-1to2",
    label: "Split Screen 1 to 2",
    startFrame: 810,
    endFrame: 840,
    easing: "power2.inOut",
    animatedProps: [
      { property: "progress", from: "0", to: "1", unit: "", keyframes: [] },
    ],
  });
  const splitScreen1to2Progress = trackProgress(
    globalFrame,
    fps,
    splitScreenTrack1,
  );
  const split1to2 = getPropValue(
    splitScreen1to2Progress,
    splitScreenTrack1,
    "progress",
    0,
    1,
  );

  const splitScreenTrack2 = findTrack(tracks, "split-screen-2to3", {
    id: "split-screen-2to3",
    label: "Split Screen 2 to 3",
    startFrame: 880,
    endFrame: 910,
    easing: "power2.inOut",
    animatedProps: [
      { property: "progress", from: "0", to: "1", unit: "", keyframes: [] },
    ],
  });
  const splitScreen2to3Progress = trackProgress(
    globalFrame,
    fps,
    splitScreenTrack2,
  );
  const split2to3 = getPropValue(
    splitScreen2to3Progress,
    splitScreenTrack2,
    "progress",
    0,
    1,
  );

  // Typing animations for each split screen
  const screen1TypingTrack = findTrack(tracks, "screen1-typing", {
    id: "screen1-typing",
    label: "Screen 1 Typing",
    startFrame: 795,
    endFrame: 875,
    easing: "linear",
    animatedProps: [
      { property: "progress", from: "0", to: "1", unit: "", keyframes: [] },
    ],
  });
  const screen1TypingProgress = trackProgress(
    globalFrame,
    fps,
    screen1TypingTrack,
  );
  const screen1Typing = getPropValue(
    screen1TypingProgress,
    screen1TypingTrack,
    "progress",
    0,
    1,
  );

  const screen2TypingTrack = findTrack(tracks, "screen2-typing", {
    id: "screen2-typing",
    label: "Screen 2 Typing",
    startFrame: 825,
    endFrame: 920,
    easing: "linear",
    animatedProps: [
      { property: "progress", from: "0", to: "1", unit: "", keyframes: [] },
    ],
  });
  const screen2TypingProgress = trackProgress(
    globalFrame,
    fps,
    screen2TypingTrack,
  );
  const screen2Typing = getPropValue(
    screen2TypingProgress,
    screen2TypingTrack,
    "progress",
    0,
    1,
  );

  const screen3TypingTrack = findTrack(tracks, "screen3-typing", {
    id: "screen3-typing",
    label: "Screen 3 Typing",
    startFrame: 865,
    endFrame: 960,
    easing: "linear",
    animatedProps: [
      { property: "progress", from: "0", to: "1", unit: "", keyframes: [] },
    ],
  });
  const screen3TypingProgress = trackProgress(
    globalFrame,
    fps,
    screen3TypingTrack,
  );
  const screen3Typing = getPropValue(
    screen3TypingProgress,
    screen3TypingTrack,
    "progress",
    0,
    1,
  );

  // Collapse to kanban animation (after frame 970)
  const collapseTrack = findTrack(tracks, "collapse-to-kanban", {
    id: "collapse-to-kanban",
    label: "Collapse to Kanban Cards",
    startFrame: 970,
    endFrame: 1010,
    easing: "spring",
    animatedProps: [
      { property: "progress", from: "0", to: "1", unit: "", keyframes: [] },
    ],
  });
  const collapseProgress = trackProgress(globalFrame, fps, collapseTrack);
  const collapseAmount = getPropValue(
    collapseProgress,
    collapseTrack,
    "progress",
    0,
    1,
  );

  // Kanban cards flying in waves (after collapse)
  const wave1Track = findTrack(tracks, "kanban-cards-wave1", {
    id: "kanban-cards-wave1",
    label: "Kanban Cards Wave 1",
    startFrame: 1020,
    endFrame: 1055,
    easing: "expo.out",
    animatedProps: [
      { property: "progress", from: "0", to: "1", unit: "", keyframes: [] },
    ],
  });
  const wave1Progress = trackProgress(globalFrame, fps, wave1Track);
  const wave1 = getPropValue(wave1Progress, wave1Track, "progress", 0, 1);

  const wave2Track = findTrack(tracks, "kanban-cards-wave2", {
    id: "kanban-cards-wave2",
    label: "Kanban Cards Wave 2",
    startFrame: 1040,
    endFrame: 1075,
    easing: "expo.out",
    animatedProps: [
      { property: "progress", from: "0", to: "1", unit: "", keyframes: [] },
    ],
  });
  const wave2Progress = trackProgress(globalFrame, fps, wave2Track);
  const wave2 = getPropValue(wave2Progress, wave2Track, "progress", 0, 1);

  const wave3Track = findTrack(tracks, "kanban-cards-wave3", {
    id: "kanban-cards-wave3",
    label: "Kanban Cards Wave 3",
    startFrame: 1060,
    endFrame: 1095,
    easing: "expo.out",
    animatedProps: [
      { property: "progress", from: "0", to: "1", unit: "", keyframes: [] },
    ],
  });
  const wave3Progress = trackProgress(globalFrame, fps, wave3Track);
  const wave3 = getPropValue(wave3Progress, wave3Track, "progress", 0, 1);

  // "Works anywhere" typing animation at frame 764 (global 1100)
  const worksTypingTrack = findTrack(tracks, "works-anywhere-typing", {
    id: "works-anywhere-typing",
    label: "Works Anywhere Typing",
    startFrame: 764,
    endFrame: 804,
    easing: "linear",
    animatedProps: [
      { property: "progress", from: "0", to: "1", unit: "", keyframes: [] },
    ],
  });
  const worksTypingProgress = trackProgress(globalFrame, fps, worksTypingTrack);
  const worksTyping = getPropValue(
    worksTypingProgress,
    worksTypingTrack,
    "progress",
    0,
    1,
  );

  // Phone slide-in animation
  const phoneSlideTrack = findTrack(tracks, "phone-slide-in", {
    id: "phone-slide-in",
    label: "Phone Slide In",
    startFrame: 770,
    endFrame: 800,
    easing: "expo.out",
    animatedProps: [
      { property: "x", from: "250", to: "0", unit: "px", keyframes: [] },
      { property: "opacity", from: "0", to: "1", unit: "", keyframes: [] },
    ],
  });
  const phoneSlideProgress = trackProgress(globalFrame, fps, phoneSlideTrack);
  const phoneX = getPropValue(phoneSlideProgress, phoneSlideTrack, "x", 250, 0);
  const phoneOpacity = getPropValue(
    phoneSlideProgress,
    phoneSlideTrack,
    "opacity",
    0,
    1,
  );

  // Phone 2 rotate animation
  const phone2Track = findTrack(tracks, "phone2-rotate", {
    id: "phone2-rotate",
    label: "Phone 2 Rotate In",
    startFrame: 810,
    endFrame: 840,
    easing: "expo.out",
    animatedProps: [
      { property: "rotate", from: "0", to: "-15", unit: "deg", keyframes: [] },
      { property: "opacity", from: "0", to: "1", unit: "", keyframes: [] },
    ],
  });
  const phone2Progress = trackProgress(globalFrame, fps, phone2Track);
  const phone2Rotate = getPropValue(
    phone2Progress,
    phone2Track,
    "rotate",
    0,
    -15,
  );
  const phone2Opacity = getPropValue(
    phone2Progress,
    phone2Track,
    "opacity",
    0,
    1,
  );

  // Phone 3 rotate animation
  const phone3Track = findTrack(tracks, "phone3-rotate", {
    id: "phone3-rotate",
    label: "Phone 3 Rotate In",
    startFrame: 820,
    endFrame: 850,
    easing: "expo.out",
    animatedProps: [
      { property: "rotate", from: "0", to: "-30", unit: "deg", keyframes: [] },
      { property: "opacity", from: "0", to: "1", unit: "", keyframes: [] },
    ],
  });
  const phone3Progress = trackProgress(globalFrame, fps, phone3Track);
  const phone3Rotate = getPropValue(
    phone3Progress,
    phone3Track,
    "rotate",
    0,
    -30,
  );
  const phone3Opacity = getPropValue(
    phone3Progress,
    phone3Track,
    "opacity",
    0,
    1,
  );

  // Tap animation on Send PR button
  const tapTrack = findTrack(tracks, "send-pr-tap", {
    id: "send-pr-tap",
    label: "Send PR Tap Animation",
    startFrame: 816,
    endFrame: 836,
    easing: "power2.out",
    animatedProps: [
      { property: "scale", from: "0", to: "1", unit: "", keyframes: [] },
      { property: "opacity", from: "0.6", to: "0", unit: "", keyframes: [] },
    ],
  });
  const tapProgress = trackProgress(globalFrame, fps, tapTrack);
  const tapScale = getPropValue(tapProgress, tapTrack, "scale", 0, 1);
  const tapOpacity = getPropValue(tapProgress, tapTrack, "opacity", 0.6, 0);

  // Calculate screen widths and positions based on split progress
  // Stage 1 (1 screen): width 100%
  // Stage 2 (2 screens): width 50% each
  // Stage 3 (3 screens): width 33.33% each
  const screen1Width =
    split1to2 < 1
      ? 100 - 50 * split1to2 // 100% → 50%
      : 50 - 16.67 * split2to3; // 50% → 33.33%

  const screen2Width =
    split2to3 < 1
      ? 50 - 16.67 * split2to3 // 50% → 33.33%
      : 33.33;

  const screen3Width = 33.33;

  // Calculate collapsed height for kanban columns
  // Start at 100% height, collapse to column height that can fit multiple cards (~70%)
  const screenHeightPercent =
    collapseAmount < 1
      ? 100 - collapseAmount * 30 // 100% → 70% during collapse
      : 70; // Stay at 70% after collapse

  const screen1Left = 0;
  const screen2Left = screen1Width;
  const screen3Left = screen1Width + screen2Width;

  // Hide UI at frame 720 and show typing text instead
  const showUI = globalFrame < 720;
  const showReviewTyping = globalFrame >= 720 && globalFrame < 780;
  const showFleetTyping = globalFrame >= 1010 && globalFrame < 1100;
  const showSplitScreen = globalFrame >= 810 && globalFrame < 1100;
  const showWorksAnywhere = globalFrame >= 1100; // Show "Works anywhere" at global frame 1100

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: width,
        height: height,
        backgroundColor: "#0a0a0a",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: padding,
      }}
    >
      {/* Show typing text "Get your changes reviewed" at frame 720+ */}
      {showReviewTyping && (
        <div
          style={{
            fontSize: 80,
            color: "#ffffff",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            fontFamily: "'Inter', sans-serif",
          }}
        >
          {reviewVisibleText}
          {/* Blinking cursor during typing */}
          {reviewTypingProgress > 0 && reviewTypingProgress < 1 && (
            <span
              style={{
                marginLeft: 4,
                opacity: Math.sin(frame * 0.3) > 0 ? 1 : 0,
              }}
            >
              |
            </span>
          )}
        </div>
      )}

      {/* Show typing text "Manage a fleet of agents" at frame 1010+ above kanban board */}
      {showFleetTyping && showSplitScreen && (
        <div
          style={{
            position: "absolute",
            top: padding - 10,
            left: 0,
            right: 0,
            textAlign: "center",
            fontSize: 64,
            color: "#ffffff",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            fontFamily: "'Inter', sans-serif",
            zIndex: 100,
          }}
        >
          {fleetVisibleText}
          {/* Blinking cursor during typing */}
          {fleetTypingProgress > 0 && fleetTypingProgress < 1 && (
            <span
              style={{
                marginLeft: 4,
                opacity: Math.sin(frame * 0.3) > 0 ? 1 : 0,
              }}
            >
              |
            </span>
          )}
        </div>
      )}

      {/* Split-screen view with three Builder chats */}
      {showSplitScreen && (
        <div
          style={{
            position: "absolute",
            inset: padding,
            display: "flex",
            gap: 20,
            alignItems: "center",
          }}
        >
          {/* Screen 1 */}
          <div
            style={{
              width: `${screen1Width}%`,
              height: `${screenHeightPercent}%`,
              backgroundColor: "#1d1d1d",
              borderRadius: 20,
              overflow: "hidden",
              boxShadow: "0 20px 60px rgba(0, 0, 0, 0.5)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              display: "flex",
              flexDirection: "column",
              justifyContent: collapseAmount > 0.5 ? "flex-start" : "flex-end",
              alignItems: "stretch",
              flexShrink: 0,
              position: "relative",
              paddingLeft: collapseAmount > 0.5 ? 20 : 0,
              paddingRight: collapseAmount > 0.5 ? 20 : 0,
              paddingTop: collapseAmount > 0.5 ? 50 : 0,
              paddingBottom: collapseAmount > 0.5 ? 50 : 0,
              overflow: collapseAmount > 0.5 ? "hidden" : "hidden",
            }}
          >
            {collapseAmount < 0.5 ? (
              <div
                style={{
                  position: "absolute",
                  width: 340,
                  height: 880,
                  bottom: 0,
                  transform: "scale(1.5)",
                  transformOrigin: "bottom left",
                  opacity: 1 - collapseAmount * 2,
                }}
              >
                <AgentPanel
                  branchName="feature/auth"
                  projectName="dashboard-app"
                  activeMode="interact"
                  activePanel="agent"
                  activeChatTab="chat"
                  typingProgress={screen1Typing}
                  menuOpacity={0}
                  menuY={0}
                  menuSelectionProgress={0}
                  sendMessageProgress={0}
                  mentionHintOpacity={0}
                  mentionHintY={0}
                  mentionHintScale={1}
                  typingMessage="Add user authentication flow with social login options and two-factor authentication"
                  chatHistory={[
                    {
                      type: "user",
                      message: "Set up user authentication with JWT tokens",
                    },
                    {
                      type: "agent",
                      message:
                        "I'll create the auth system with secure token handling.",
                      toolCards: [
                        {
                          icon: "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/170c326234704ac352455efad4509914bbd65de9?placeholderIfAbsent=true",
                          text: "Read server/auth/jwt.ts",
                        },
                        {
                          icon: "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/170c326234704ac352455efad4509914bbd65de9?placeholderIfAbsent=true",
                          text: "Read client/hooks/useAuth.ts",
                        },
                      ],
                    },
                    {
                      type: "agent",
                      message:
                        "Auth system is ready with JWT tokens, refresh logic, and protected routes.",
                    },
                  ]}
                  thinkingText="I'm reviewing the authentication patterns in the codebase and setting up secure token storage with httpOnly cookies to prevent XSS attacks."
                />
              </div>
            ) : (
              // Kanban column view
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  opacity: (collapseAmount - 0.5) * 2,
                  gap: 20,
                }}
              >
                {/* Column Header */}
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 600,
                    color: "#ffffff",
                    fontFamily: "Inter, sans-serif",
                    paddingBottom: 8,
                    borderBottom: "2px solid #343434",
                  }}
                >
                  IN PROGRESS
                </div>

                {/* Cards */}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 16,
                  }}
                >
                  {/* First card from chat */}
                  <BranchCard
                    branchName="feature/auth"
                    projectName="dashboard-app"
                    status="IN PROGRESS"
                    avatarLetter="L"
                    avatarColor="#3B82F6"
                  />

                  {/* Wave 1 cards */}
                  {wave1 > 0 && (
                    <div
                      style={{
                        transform: `translateY(${(1 - wave1) * 100}px)`,
                        opacity: wave1,
                      }}
                    >
                      <BranchCard
                        branchName="feature/notifications"
                        projectName="dashboard-app"
                        status="IN PROGRESS"
                        avatarLetter="J"
                        avatarColor="#EC4899"
                      />
                    </div>
                  )}

                  {/* Wave 2 cards */}
                  {wave2 > 0 && (
                    <div
                      style={{
                        transform: `translateY(${(1 - wave2) * 100}px)`,
                        opacity: wave2,
                      }}
                    >
                      <BranchCard
                        branchName="feature/dark-mode"
                        projectName="ui-library"
                        status="IN PROGRESS"
                        avatarLetter="A"
                        avatarColor="#8B5CF6"
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Screen 2 - appears when split1to2 > 0 */}
          {split1to2 > 0 && (
            <div
              style={{
                width: `${screen2Width}%`,
                height: `${screenHeightPercent}%`,
                backgroundColor: "#1d1d1d",
                borderRadius: 20,
                overflow: "hidden",
                boxShadow: "0 20px 60px rgba(0, 0, 0, 0.5)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                opacity: split1to2,
                display: "flex",
                flexDirection: "column",
                justifyContent: collapseAmount > 0.5 ? "center" : "flex-end",
                alignItems: collapseAmount > 0.5 ? "flex-start" : "stretch",
                flexShrink: 0,
                position: "relative",
                paddingLeft: collapseAmount > 0.5 ? 20 : 0,
                paddingRight: collapseAmount > 0.5 ? 20 : 0,
                paddingTop: collapseAmount > 0.5 ? 50 : 0,
                paddingBottom: collapseAmount > 0.5 ? 50 : 0,
              }}
            >
              {collapseAmount < 0.5 ? (
                <div
                  style={{
                    position: "absolute",
                    width: 340,
                    height: 880,
                    bottom: 0,
                    transform: "scale(1.5)",
                    transformOrigin: "bottom left",
                    opacity: 1 - collapseAmount * 2,
                  }}
                >
                  <AgentPanel
                    branchName="feature/payments"
                    projectName="checkout-flow"
                    activeMode="interact"
                    activePanel="agent"
                    activeChatTab="chat"
                    typingProgress={screen2Typing}
                    menuOpacity={0}
                    menuY={0}
                    menuSelectionProgress={0}
                    sendMessageProgress={0}
                    mentionHintOpacity={0}
                    mentionHintY={0}
                    mentionHintScale={1}
                    typingMessage="Implement @stripe payment integration with webhooks and subscription management"
                    chatHistory={[
                      {
                        type: "user",
                        message: "I need to integrate Stripe payments",
                      },
                      {
                        type: "agent",
                        message: "Let me set up the payment infrastructure.",
                        toolCards: [
                          {
                            icon: "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/f60dae9587b0e78e28b55185db42f7e65a228368?placeholderIfAbsent=true",
                            text: "List directory structure",
                          },
                          {
                            icon: "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/e4cd1b35e969a5988a4652cb762b0d43aa9b30d1?placeholderIfAbsent=true",
                            text: "Todo list (2/4 completed)",
                          },
                          {
                            icon: "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/170c326234704ac352455efad4509914bbd65de9?placeholderIfAbsent=true",
                            text: "Read server/payments/stripe.ts",
                          },
                        ],
                      },
                      {
                        type: "agent",
                        message:
                          "Payment system deployed! Checkout works with all major cards, webhooks handle subscription events, and receipts are auto-generated.",
                      },
                    ]}
                    thinkingText="I'm setting up Stripe webhook endpoints and implementing event handlers for payment.succeeded, payment.failed, and subscription.updated events."
                  />
                </div>
              ) : (
                // Kanban column view
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    opacity: (collapseAmount - 0.5) * 2,
                    gap: 20,
                  }}
                >
                  {/* Column Header */}
                  <div
                    style={{
                      fontSize: 24,
                      fontWeight: 600,
                      color: "#ffffff",
                      fontFamily: "Inter, sans-serif",
                      paddingBottom: 8,
                      borderBottom: "2px solid #343434",
                    }}
                  >
                    IN REVIEW
                  </div>

                  {/* Cards */}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 16,
                    }}
                  >
                    {/* First card from chat */}
                    <BranchCard
                      branchName="feature/payments"
                      projectName="checkout-flow"
                      status="IN REVIEW"
                      avatarLetter="S"
                      avatarColor="#10B981"
                    />

                    {/* Wave 1 cards */}
                    {wave1 > 0 && (
                      <div
                        style={{
                          transform: `translateY(${(1 - wave1) * 100}px)`,
                          opacity: wave1,
                        }}
                      >
                        <BranchCard
                          branchName="feature/api-v2"
                          projectName="backend-services"
                          status="IN REVIEW"
                          avatarLetter="R"
                          avatarColor="#F59E0B"
                        />
                      </div>
                    )}

                    {/* Wave 3 cards */}
                    {wave3 > 0 && (
                      <div
                        style={{
                          transform: `translateY(${(1 - wave3) * 100}px)`,
                          opacity: wave3,
                        }}
                      >
                        <BranchCard
                          branchName="feature/email-templates"
                          projectName="marketing-site"
                          status="IN REVIEW"
                          avatarLetter="K"
                          avatarColor="#14B8A6"
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Screen 3 - appears when split2to3 > 0 */}
          {split2to3 > 0 && (
            <div
              style={{
                width: `${screen3Width}%`,
                height: `${screenHeightPercent}%`,
                backgroundColor: "#1d1d1d",
                borderRadius: 20,
                overflow: "hidden",
                boxShadow: "0 20px 60px rgba(0, 0, 0, 0.5)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                opacity: split2to3,
                display: "flex",
                flexDirection: "column",
                justifyContent: collapseAmount > 0.5 ? "center" : "flex-end",
                alignItems: collapseAmount > 0.5 ? "flex-start" : "stretch",
                flexShrink: 0,
                position: "relative",
                paddingLeft: collapseAmount > 0.5 ? 20 : 0,
                paddingRight: collapseAmount > 0.5 ? 20 : 0,
                paddingTop: collapseAmount > 0.5 ? 50 : 0,
                paddingBottom: collapseAmount > 0.5 ? 50 : 0,
              }}
            >
              {collapseAmount < 0.5 ? (
                <div
                  style={{
                    position: "absolute",
                    width: 340,
                    height: 880,
                    bottom: 0,
                    transform: "scale(1.5)",
                    transformOrigin: "bottom left",
                    opacity: 1 - collapseAmount * 2,
                  }}
                >
                  <AgentPanel
                    branchName="feature/analytics"
                    projectName="metrics-dashboard"
                    activeMode="interact"
                    activePanel="agent"
                    activeChatTab="chat"
                    typingProgress={screen3Typing}
                    menuOpacity={0}
                    menuY={0}
                    menuSelectionProgress={0}
                    sendMessageProgress={0}
                    mentionHintOpacity={0}
                    mentionHintY={0}
                    mentionHintScale={1}
                    typingMessage="Create an interactive revenue @chart with real-time filters and export functionality"
                    chatHistory={[
                      {
                        type: "user",
                        message: "Can you visualize our sales data?",
                      },
                      {
                        type: "agent",
                        message:
                          "I'll build an interactive dashboard for your data.",
                        toolCards: [
                          {
                            icon: "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/3f4d77d75ee856af2f9887264c2cfdf7286cf001?placeholderIfAbsent=true",
                            text: "Found 12 data visualization libraries",
                          },
                          {
                            icon: "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/0a54d3526fbcc1758538f043a19b148cf84e2c3d?placeholderIfAbsent=true",
                            text: "Database query executed",
                          },
                        ],
                      },
                      { type: "user", message: "Add export to PDF" },
                      {
                        type: "agent",
                        message:
                          "Dashboard complete with PDF export! Charts show real-time revenue trends, growth metrics, and export includes all filtered data.",
                      },
                    ]}
                    thinkingText="I'm querying the sales database and implementing PDF generation with chart snapshots. Using recharts for smooth rendering and jsPDF for document export."
                  />
                </div>
              ) : (
                // Kanban column view
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    opacity: (collapseAmount - 0.5) * 2,
                    gap: 20,
                  }}
                >
                  {/* Column Header */}
                  <div
                    style={{
                      fontSize: 24,
                      fontWeight: 600,
                      color: "#ffffff",
                      fontFamily: "Inter, sans-serif",
                      paddingBottom: 8,
                      borderBottom: "2px solid #343434",
                    }}
                  >
                    PR OPEN
                  </div>

                  {/* Cards */}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 16,
                    }}
                  >
                    {/* First card from chat */}
                    <BranchCard
                      branchName="feature/analytics"
                      projectName="metrics-dashboard"
                      status="PR OPEN"
                      avatarLetter="M"
                      avatarColor="#8B5CF6"
                    />

                    {/* Wave 2 cards */}
                    {wave2 > 0 && (
                      <div
                        style={{
                          transform: `translateY(${(1 - wave2) * 100}px)`,
                          opacity: wave2,
                        }}
                      >
                        <BranchCard
                          branchName="feature/search"
                          projectName="frontend-app"
                          status="PR OPEN"
                          avatarLetter="T"
                          avatarColor="#EF4444"
                        />
                      </div>
                    )}

                    {/* Wave 3 cards */}
                    {wave3 > 0 && (
                      <div
                        style={{
                          transform: `translateY(${(1 - wave3) * 100}px)`,
                          opacity: wave3,
                        }}
                      >
                        <BranchCard
                          branchName="feature/mobile-nav"
                          projectName="mobile-app"
                          status="PR OPEN"
                          avatarLetter="D"
                          avatarColor="#F97316"
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Inner container with shadow - hidden at frame 720+ */}
      {showUI && (
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
          {/* Left Sidebar */}
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
                marginTop: 21,
              }}
            >
              <img
                src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/237759bb622d77734aa845a40ab713ee9440deba?placeholderIfAbsent=true"
                alt=""
                style={{
                  width: 24,
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
                marginTop: 20,
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
                marginTop: 13,
              }}
            >
              <img
                src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/4f7172a65e571640e01dab37893f7d0461aaa79b?placeholderIfAbsent=true"
                alt=""
                style={{ width: 40, borderRadius: 7, cursor: "pointer" }}
              />
              <img
                src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/231224c6703aaf2c9b02921b00b812d6b52bffad?placeholderIfAbsent=true"
                alt=""
                style={{ width: 28, marginTop: 21, cursor: "pointer" }}
              />
            </div>

            {/* Divider 2 */}
            <div
              style={{
                backgroundColor: "#434343",
                height: 1,
                marginTop: 26,
                marginLeft: 14,
                marginRight: 14,
              }}
            />

            {/* Additional icons */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                marginTop: 22,
              }}
            >
              <img
                src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/0af879e4bce67490d491e3f88038f1700311e2a6?placeholderIfAbsent=true"
                alt=""
                style={{ width: 28, cursor: "pointer" }}
              />
              <img
                src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/a498ab763f2dda151d55419238849c3dff2d25e7?placeholderIfAbsent=true"
                alt=""
                style={{ width: 28, marginTop: 28, cursor: "pointer" }}
              />
            </div>

            {/* User/Settings Icon at Bottom */}
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                marginTop: "auto",
                marginBottom: 21,
              }}
            >
              <img
                src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/ab3bc7e3dec1aba837b8e7648c116a83c6463785?placeholderIfAbsent=true"
                alt=""
                style={{ width: 28, cursor: "pointer" }}
              />
            </div>
          </div>

          {/* Middle Agent Panel */}
          <AgentPanel
            branchName={branchName}
            projectName={projectName}
            activeMode="interact"
            activePanel="agent"
            activeChatTab="chat"
            typingProgress={typingProgress}
            menuOpacity={menuOpacity}
            menuY={menuY}
            menuSelectionProgress={menuSelectionProgress}
            sendMessageProgress={sendMessageProgress}
            mentionHintOpacity={mentionHintOpacity}
            mentionHintY={mentionHintY}
            mentionHintScale={mentionHintScale}
          />

          {/* Right App Preview Area */}
          <div
            style={{
              backgroundColor: "#191919",
              display: "flex",
              flex: 1,
              flexDirection: "column",
              position: "relative",
            }}
          >
            <AppPreviewHeader url={url} />

            {/* Review PR Panel - appears below Review button */}
            {reviewPROpacity > 0 && (
              <div
                style={{
                  position: "absolute",
                  top: 58,
                  right: 70,
                  zIndex: 100,
                  opacity: reviewPROpacity,
                  transform: `translateY(${reviewPRY}px) scale(${reviewPRScale})`,
                  transformOrigin: "top right",
                }}
              >
                <ReviewPR
                  initialReviewers={[
                    {
                      id: "1",
                      name: "Sarah Johnson",
                      avatarUrl:
                        "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fec2ef10d3c7343589e377f53c2d1f134?format=webp&width=800&height=1200",
                    },
                  ]}
                />
              </div>
            )}

            {/* App Preview Container */}
            <div
              style={{
                borderRadius: "23px 0 0 23px",
                backgroundColor: "#16222f",
                display: "flex",
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                fontSize: 20,
                color: "rgba(255, 255, 255, 0.3)",
                fontFamily: "Inter, sans-serif",
                fontWeight: 400,
                position: "relative",
              }}
            >
              {/* Dashboard Grid Layout */}
              <div
                style={{
                  position: "absolute",
                  inset: 40,
                  display: "grid",
                  gridTemplateColumns: "200px 1fr 1.2fr",
                  gridTemplateRows: "100px 1fr 140px",
                  gap: 20,
                }}
              >
                {/* Top left - Small box */}
                <div
                  style={{
                    backgroundColor: "rgba(255, 255, 255, 0.05)",
                    borderRadius: 12,
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                  }}
                />

                {/* Top center - Small box */}
                <div
                  style={{
                    backgroundColor: "rgba(255, 255, 255, 0.05)",
                    borderRadius: 12,
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                  }}
                />

                {/* Top right - Tall box spanning 2 rows */}
                <div
                  style={{
                    backgroundColor: "rgba(255, 255, 255, 0.05)",
                    borderRadius: 12,
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    gridRow: "1 / 3",
                  }}
                />

                {/* Middle left - Box */}
                <div
                  style={{
                    backgroundColor: "rgba(255, 255, 255, 0.05)",
                    borderRadius: 12,
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                  }}
                />

                {/* Middle center - Data Visualization */}
                <div
                  style={{
                    backgroundColor: "rgba(255, 255, 255, 0.05)",
                    borderRadius: 12,
                    padding: 20,
                    border:
                      dataOutline > 0.5 && shouldHighlightChart
                        ? "3px solid #22C55E"
                        : "1px solid rgba(255, 255, 255, 0.1)",
                    transition: "border 0.2s ease",
                  }}
                >
                  {chartProgress < 0.2 ? (
                    // Data Table
                    <div>
                      <div
                        style={{
                          fontSize: 14,
                          color: "#ffffff",
                          marginBottom: 12,
                          fontWeight: 600,
                        }}
                      >
                        Sales Data
                      </div>
                      {/* Table Header */}
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "60px 80px 60px 60px",
                          gap: 8,
                          padding: "6px 12px",
                          fontSize: 10,
                          color: "#999999",
                          fontWeight: 600,
                          borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
                          marginBottom: 6,
                        }}
                      >
                        <span>Quarter</span>
                        <span>Revenue</span>
                        <span>Growth</span>
                        <span>Target</span>
                      </div>
                      {/* Table Rows */}
                      {[
                        {
                          label: "Q1",
                          value: 45,
                          growth: "+12%",
                          target: "50k",
                        },
                        {
                          label: "Q2",
                          value: 72,
                          growth: "+18%",
                          target: "70k",
                        },
                        {
                          label: "Q3",
                          value: 58,
                          growth: "+8%",
                          target: "60k",
                        },
                        {
                          label: "Q4",
                          value: 89,
                          growth: "+24%",
                          target: "85k",
                        },
                        {
                          label: "Jan",
                          value: 34,
                          growth: "+5%",
                          target: "40k",
                        },
                        {
                          label: "Feb",
                          value: 52,
                          growth: "+15%",
                          target: "50k",
                        },
                        {
                          label: "Mar",
                          value: 61,
                          growth: "+22%",
                          target: "60k",
                        },
                        {
                          label: "Apr",
                          value: 48,
                          growth: "+9%",
                          target: "55k",
                        },
                      ].map((item, i) => (
                        <div
                          key={i}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "60px 80px 60px 60px",
                            gap: 8,
                            padding: "8px 12px",
                            marginBottom: 4,
                            backgroundColor: "rgba(255, 255, 255, 0.03)",
                            borderRadius: 6,
                            fontSize: 12,
                            color: "#ffffff",
                            opacity: 1 - chartProgress * 5,
                          }}
                        >
                          <span style={{ color: "#999999" }}>{item.label}</span>
                          <span style={{ fontWeight: 600 }}>
                            ${item.value}k
                          </span>
                          <span style={{ color: "#22C55E" }}>
                            {item.growth}
                          </span>
                          <span style={{ color: "#999999" }}>
                            {item.target}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    // Bar Chart
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        height: "100%",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 16,
                          color: "#ffffff",
                          marginBottom: 16,
                          fontWeight: 600,
                        }}
                      >
                        Sales Data
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "flex-end",
                          justifyContent: "space-around",
                          gap: 8,
                          flex: 1,
                        }}
                      >
                        {[
                          { label: "Q1", value: 45, color: "#3B82F6" },
                          { label: "Q2", value: 72, color: "#10B981" },
                          { label: "Q3", value: 58, color: "#F59E0B" },
                          { label: "Q4", value: 89, color: "#EF4444" },
                          { label: "Jan", value: 34, color: "#8B5CF6" },
                          { label: "Feb", value: 52, color: "#EC4899" },
                          { label: "Mar", value: 61, color: "#14B8A6" },
                          { label: "Apr", value: 48, color: "#F43F5E" },
                        ].map((item, i) => (
                          <div
                            key={i}
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                              gap: 8,
                              flex: 1,
                            }}
                          >
                            <div
                              style={{
                                width: "100%",
                                maxWidth: 50,
                                height:
                                  (item.value / 100) *
                                  280 *
                                  Math.min(1, (chartProgress - 0.2) * 2),
                                backgroundColor: item.color,
                                borderRadius: "6px 6px 0 0",
                                transition: "height 0.3s ease",
                              }}
                            />
                            <div style={{ fontSize: 11, color: "#999999" }}>
                              {item.label}
                            </div>
                            <div
                              style={{
                                fontSize: 11,
                                color: "#ffffff",
                                fontWeight: 600,
                              }}
                            >
                              ${item.value}k
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Bottom left - Wide box spanning 2 columns */}
                <div
                  style={{
                    backgroundColor: "rgba(255, 255, 255, 0.05)",
                    borderRadius: 12,
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    gridColumn: "1 / 3",
                  }}
                />

                {/* Bottom right - Box */}
                <div
                  style={{
                    backgroundColor: "rgba(255, 255, 255, 0.05)",
                    borderRadius: 12,
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                  }}
                />
              </div>

              {/* Cursor 1 - Yellow */}
              <div
                style={{
                  position: "absolute",
                  left: `${yellowCursor.x}%`,
                  top: `${yellowCursor.y}%`,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  opacity: cursorOpacity,
                  transition: "left 0.3s ease-out, top 0.3s ease-out",
                }}
              >
                <svg
                  width="27"
                  height="36"
                  viewBox="0 0 27 36"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M0 36V0L26.5263 21.9935H9.47369L0 36Z"
                    fill="#F7DF1E"
                  />
                </svg>
                <div
                  style={{
                    backgroundColor: "#F7DF1E",
                    color: "#000000",
                    padding: "4px 10px",
                    borderRadius: 12,
                    fontSize: 13,
                    fontWeight: 600,
                    marginTop: 4,
                    marginLeft: 8,
                  }}
                >
                  Firstname L
                </div>
              </div>

              {/* Cursor 2 - Purple */}
              <div
                style={{
                  position: "absolute",
                  left: `${purpleCursor.x}%`,
                  top: `${purpleCursor.y}%`,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  opacity: cursorOpacity,
                  transition: "left 0.3s ease-out, top 0.3s ease-out",
                }}
              >
                <svg
                  width="27"
                  height="36"
                  viewBox="0 0 27 36"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M0 36V0L26.5263 21.9935H9.47369L0 36Z"
                    fill="#A855F7"
                  />
                </svg>
                <div
                  style={{
                    backgroundColor: "#A855F7",
                    color: "#000000",
                    padding: "4px 10px",
                    borderRadius: 12,
                    fontSize: 13,
                    fontWeight: 600,
                    marginTop: 4,
                    marginLeft: 8,
                  }}
                >
                  Sarah K
                </div>
              </div>

              {/* Cursor 3 - Green (Alex - Animated) */}
              <div
                style={{
                  position: "absolute",
                  left: `${alexCursorX}%`,
                  top: `${alexCursorY}%`,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  transform: `scale(${alexCursorScale})`,
                  transformOrigin: "top left",
                  opacity: cursorOpacity,
                }}
              >
                <svg
                  width="27"
                  height="36"
                  viewBox="0 0 27 36"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M0 36V0L26.5263 21.9935H9.47369L0 36Z"
                    fill="#22C55E"
                  />
                </svg>
                <div
                  style={{
                    backgroundColor: "#22C55E",
                    color: "#000000",
                    padding: "4px 10px",
                    borderRadius: 12,
                    fontSize: 13,
                    fontWeight: 600,
                    marginTop: 4,
                    marginLeft: 8,
                  }}
                >
                  Alex M
                </div>
              </div>

              {/* Cursor 4 - Orange */}
              <div
                style={{
                  position: "absolute",
                  left: `${orangeCursor.x}%`,
                  top: `${orangeCursor.y}%`,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  opacity: cursorOpacity,
                  transition: "left 0.3s ease-out, top 0.3s ease-out",
                }}
              >
                <svg
                  width="27"
                  height="36"
                  viewBox="0 0 27 36"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M0 36V0L26.5263 21.9935H9.47369L0 36Z"
                    fill="#F97316"
                  />
                </svg>
                <div
                  style={{
                    backgroundColor: "#F97316",
                    color: "#000000",
                    padding: "4px 10px",
                    borderRadius: 12,
                    fontSize: 13,
                    fontWeight: 600,
                    marginTop: 4,
                    marginLeft: 8,
                  }}
                >
                  Jordan P
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Show "Works anywhere" scene after frame 1098 */}
      {showWorksAnywhere && (
        <div
          style={{
            position: "absolute",
            inset: padding,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 100,
          }}
        >
          {/* Left side - "Works anywhere" text */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 20,
              flex: 1,
            }}
          >
            {/* "Works" line */}
            <div
              style={{
                fontSize: 120,
                fontWeight: 700,
                color: "#ffffff",
                fontFamily: "'Inter', sans-serif",
                letterSpacing: "-0.03em",
                lineHeight: 1,
              }}
            >
              {worksTyping >= 0.5
                ? "Works"
                : "Works".slice(0, Math.floor(worksTyping * 2 * 5))}
              {worksTyping > 0 && worksTyping < 0.5 && (
                <span
                  style={{
                    marginLeft: 4,
                    opacity: Math.sin(frame * 0.3) > 0 ? 1 : 0,
                  }}
                >
                  |
                </span>
              )}
            </div>
            {/* "anywhere" line */}
            <div
              style={{
                fontSize: 120,
                fontWeight: 700,
                color: "#ffffff",
                fontFamily: "'Inter', sans-serif",
                letterSpacing: "-0.03em",
                lineHeight: 1,
                opacity: worksTyping >= 0.5 ? 1 : 0,
              }}
            >
              {worksTyping >= 0.5
                ? "anywhere".slice(0, Math.floor((worksTyping - 0.5) * 2 * 8))
                : ""}
              {worksTyping >= 0.5 && worksTyping < 1 && (
                <span
                  style={{
                    marginLeft: 4,
                    opacity: Math.sin(frame * 0.3) > 0 ? 1 : 0,
                  }}
                >
                  |
                </span>
              )}
            </div>
          </div>

          {/* Right side - Phone mockups container */}
          <div
            style={{
              position: "relative",
              width: 580,
              height: 840,
            }}
          >
            {/* Phone 3 - bottom layer, rotated -30deg */}
            {phone3Opacity > 0 && (
              <div
                style={{
                  width: 580,
                  height: 840,
                  backgroundColor: "#1a1a1a",
                  borderRadius: 40,
                  border: "8px solid #2d2d2d",
                  overflow: "hidden",
                  position: "absolute",
                  boxShadow: "0 40px 100px rgba(0, 0, 0, 0.6)",
                  transform: `rotate(${phone3Rotate}deg)`,
                  transformOrigin: "center bottom",
                  opacity: phone3Opacity * 0.7,
                  zIndex: 1,
                }}
              >
                <div
                  style={{
                    height: 80,
                    backgroundColor: "#151515",
                    borderBottom: "1px solid #2d2d2d",
                  }}
                />
                <div
                  style={{
                    padding: 20,
                    backgroundColor: "#0f1923",
                    height: "calc(100% - 80px)",
                  }}
                />
              </div>
            )}

            {/* Phone 2 - middle layer, rotated -15deg */}
            {phone2Opacity > 0 && (
              <div
                style={{
                  width: 580,
                  height: 840,
                  backgroundColor: "#1c1c1c",
                  borderRadius: 40,
                  border: "8px solid #2d2d2d",
                  overflow: "hidden",
                  position: "absolute",
                  boxShadow: "0 40px 100px rgba(0, 0, 0, 0.6)",
                  transform: `rotate(${phone2Rotate}deg)`,
                  transformOrigin: "center bottom",
                  opacity: phone2Opacity * 0.85,
                  zIndex: 2,
                }}
              >
                <div
                  style={{
                    height: 80,
                    backgroundColor: "#171717",
                    borderBottom: "1px solid #343434",
                  }}
                />
                <div
                  style={{
                    padding: 20,
                    backgroundColor: "#121c27",
                    height: "calc(100% - 80px)",
                  }}
                />
              </div>
            )}

            {/* Phone 1 - top layer (main phone with buttons) */}
            <div
              style={{
                width: 580,
                height: 840,
                backgroundColor: "#1d1d1d",
                borderRadius: 40,
                border: "8px solid #2d2d2d",
                overflow: "hidden",
                position: "absolute",
                boxShadow: "0 40px 100px rgba(0, 0, 0, 0.6)",
                transform: `translateX(${phoneX}px)`,
                opacity: phoneOpacity,
                zIndex: 3,
              }}
            >
              {/* Top bar with buttons */}
              <div
                style={{
                  height: 80,
                  backgroundColor: "#191919",
                  borderBottom: "1px solid #434343",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  padding: "0 16px",
                  gap: 12,
                }}
              >
                {/* Icon buttons */}
                <img
                  src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/5a657a3a7c0c66f62298e506a1cdcd33b0fa5801?placeholderIfAbsent=true"
                  alt=""
                  style={{
                    width: 32,
                    aspectRatio: 1,
                    objectFit: "contain",
                    cursor: "pointer",
                  }}
                />
                <img
                  src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/15e9b2a090b28b7953c43ca932eb877a204f19a0?placeholderIfAbsent=true"
                  alt=""
                  style={{
                    width: 32,
                    aspectRatio: 1,
                    objectFit: "contain",
                    cursor: "pointer",
                  }}
                />

                {/* Share button */}
                <div
                  style={{
                    borderRadius: 14,
                    backgroundColor: "#2a2a2a",
                    borderColor: "#393939",
                    borderStyle: "solid",
                    borderWidth: 2,
                    padding: "12px 26px",
                    fontSize: 22,
                    color: "#ffffff",
                    fontWeight: 500,
                    fontFamily: "'Inter', sans-serif",
                    cursor: "pointer",
                  }}
                >
                  Share
                </div>

                {/* Review button */}
                <div
                  style={{
                    borderRadius: 14,
                    backgroundColor: "#2a2a2a",
                    borderColor: "#393939",
                    borderStyle: "solid",
                    borderWidth: 2,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "12px 14px",
                    fontSize: 22,
                    color: "#ffffff",
                    fontWeight: 500,
                    fontFamily: "'Inter', sans-serif",
                    cursor: "pointer",
                  }}
                >
                  <img
                    src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/346da66ecfda572528b869af00117a1ceed8d613?placeholderIfAbsent=true"
                    alt=""
                    style={{ width: 28, aspectRatio: 1, objectFit: "contain" }}
                  />
                  <div>Review</div>
                </div>

                {/* Send PR button (2x size) */}
                <div
                  style={{
                    position: "relative",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 12,
                      paddingLeft: 12,
                      paddingRight: 12,
                      paddingTop: 12,
                      paddingBottom: 12,
                      backgroundColor: tapScale >= 1 ? "#6b7280" : "#48a1ff",
                      borderRadius: 14,
                      color: "#000000",
                      fontSize: 22,
                      fontWeight: 500,
                      fontFamily: "'Inter', sans-serif",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                      transition: "background-color 0.2s ease",
                    }}
                  >
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 8 }}
                    >
                      <img
                        src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/81e7eb620e52aae529258200f6dff2cc38027cd8?placeholderIfAbsent=true"
                        alt=""
                        style={{
                          aspectRatio: 1,
                          objectFit: "contain",
                          objectPosition: "center",
                          width: 32,
                        }}
                      />
                      <span>Send PR</span>
                    </div>
                    <img
                      src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/60c16d358ba374b573ddcbd6270c1393418fce3e?placeholderIfAbsent=true"
                      alt=""
                      style={{
                        width: 28,
                        aspectRatio: 1,
                        objectFit: "contain",
                      }}
                    />
                  </div>

                  {/* Tap circle animation */}
                  {tapScale > 0 && tapScale < 1 && (
                    <div
                      style={{
                        position: "absolute",
                        top: "50%",
                        left: "50%",
                        width: 80,
                        height: 80,
                        borderRadius: "50%",
                        backgroundColor: "rgba(255, 255, 255, 0.3)",
                        transform: `translate(-50%, -50%) scale(${tapScale})`,
                        opacity: tapOpacity,
                        pointerEvents: "none",
                      }}
                    />
                  )}
                </div>

                {/* Right icon button */}
                <img
                  src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/13674a145727d75c65546b84d315a6f669744b07?placeholderIfAbsent=true"
                  alt=""
                  style={{
                    width: 32,
                    aspectRatio: 1,
                    objectFit: "contain",
                    cursor: "pointer",
                  }}
                />
              </div>

              {/* Phone content area */}
              <div
                style={{
                  padding: 20,
                  backgroundColor: "#16222f",
                  height: "calc(100% - 80px)",
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
