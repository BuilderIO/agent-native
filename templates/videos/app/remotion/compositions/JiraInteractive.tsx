/**
 * ═══════════════════════════════════════════════════════════════════════════
 * JIRA INTERACTIVE COMPOSITION
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Interactive showcase of the Jira task management interface with cursor animations.
 * Features:
 * - Full Jira UI with header, task details, comments, and sidebar
 * - Interactive assignee selection with dropdown and typing
 * - Springy iMessage-style comment animations
 * - Smooth cursor tracking across all interactive components
 *
 * Animation Sequence:
 * 1. Cursor flies in and clicks assignee dropdown
 * 2. Dropdown appears, cursor types "Buil"
 * 3. Cursor selects Builder.io Bot
 * 4. First comment pops in with spring animation ("just now")
 * 5. Second comment pops in with spring animation
 * 6. Cursor clicks "View/Edit in Builder.io"
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from "remotion";
import type { AnimationTrack } from "@/types";
import { findTrack, trackProgress, getPropValue } from "../trackAnimation";
import { createInteractiveComposition } from "../hooks/createInteractiveComposition";
import {
  useInteractiveComponent,
  AnimationPresets,
} from "../hooks/useInteractiveComponent";
import { JiraLayout } from "../library-components/JiraLayout";
import { iMessageSpring } from "../utils/springAnimation";

export type JiraInteractiveProps = {
  tracks?: AnimationTrack[];
};

const FALLBACK_TRACKS: AnimationTrack[] = [
  {
    id: "cursor",
    label: "Cursor Movement",
    startFrame: 0,
    endFrame: 450,
    easing: "linear",
    animatedProps: [
      {
        property: "x",
        from: "200",
        to: "960",
        unit: "px",
        keyframes: [
          { frame: 0, value: "200", easing: "expo.out" },
          { frame: 30, value: "1150", easing: "expo.inOut" }, // Fly to assignee dropdown
          { frame: 120, value: "1200", easing: "expo.inOut" }, // Move to Builder.io Bot option
          { frame: 200, value: "700", easing: "expo.inOut" }, // Move to first comment area
          { frame: 350, value: "750", easing: "expo.inOut" }, // Move to "View/Edit" link
        ],
      },
      {
        property: "y",
        from: "200",
        to: "540",
        unit: "px",
        keyframes: [
          { frame: 0, value: "100", easing: "expo.out" },
          { frame: 30, value: "290", easing: "expo.inOut" }, // Fly to assignee dropdown
          { frame: 120, value: "350", easing: "expo.inOut" }, // Move down to Builder.io Bot option
          { frame: 200, value: "550", easing: "expo.inOut" }, // Move to first comment
          { frame: 350, value: "680", easing: "expo.inOut" }, // Move to "View/Edit" link
        ],
      },
    ],
  },
  {
    id: "assignee-dropdown",
    label: "Assignee Dropdown",
    startFrame: 35,
    endFrame: 50,
    easing: "expo.out",
    animatedProps: [{ property: "opacity", from: "0", to: "1", unit: "" }],
  },
  {
    id: "assignee-typing",
    label: "Type 'Buil'",
    startFrame: 55,
    endFrame: 110,
    easing: "linear",
    animatedProps: [{ property: "chars", from: "0", to: "4", unit: "" }],
  },
  {
    id: "assignee-select",
    label: "Select Builder.io Bot",
    startFrame: 125,
    endFrame: 140,
    easing: "expo.out",
    animatedProps: [{ property: "selected", from: "0", to: "1", unit: "" }],
  },
  {
    id: "first-comment",
    label: "First Comment Appears",
    startFrame: 150,
    endFrame: 180,
    easing: "linear",
    animatedProps: [{ property: "progress", from: "0", to: "1", unit: "" }],
  },
  {
    id: "second-comment",
    label: "Second Comment Appears",
    startFrame: 210,
    endFrame: 240,
    easing: "linear",
    animatedProps: [{ property: "progress", from: "0", to: "1", unit: "" }],
  },
];

export const JiraInteractive =
  createInteractiveComposition<JiraInteractiveProps>({
    fallbackTracks: FALLBACK_TRACKS,

    render: ({ cursorHistory, tracks, registerForCursor }, props) => {
      const frame = useCurrentFrame();
      const { fps, width, height } = useVideoConfig();

      // Find animation tracks
      const dropdownTrack = findTrack(
        tracks,
        "assignee-dropdown",
        FALLBACK_TRACKS[1],
      );
      const typingTrack = findTrack(
        tracks,
        "assignee-typing",
        FALLBACK_TRACKS[2],
      );
      const selectTrack = findTrack(
        tracks,
        "assignee-select",
        FALLBACK_TRACKS[3],
      );
      const firstCommentTrack = findTrack(
        tracks,
        "first-comment",
        FALLBACK_TRACKS[4],
      );
      const secondCommentTrack = findTrack(
        tracks,
        "second-comment",
        FALLBACK_TRACKS[5],
      );

      // Calculate animation states
      const dropdownP = trackProgress(frame, fps, dropdownTrack);
      const dropdownOpacity = getPropValue(
        dropdownP,
        dropdownTrack,
        "opacity",
        0,
        1,
      );

      const typingP = trackProgress(frame, fps, typingTrack);
      const typingChars = Math.floor(
        getPropValue(typingP, typingTrack, "chars", 0, 4),
      );

      const selectP = trackProgress(frame, fps, selectTrack);
      const isSelected = selectP >= 1;

      const firstCommentP = trackProgress(frame, fps, firstCommentTrack);
      const secondCommentP = trackProgress(frame, fps, secondCommentTrack);

      // Apply spring physics to comments for bouncy animation
      const firstCommentSpring =
        firstCommentP > 0 ? iMessageSpring(firstCommentP) : 0;
      const secondCommentSpring =
        secondCommentP > 0 ? iMessageSpring(secondCommentP) : 0;

      // Determine assignee state based on timeline
      let assigneeState: "unassigned" | "dropdown" | "typing" | "assigned" =
        "unassigned";
      let typedText = "";

      if (isSelected) {
        assigneeState = "assigned";
      } else if (typingP > 0) {
        assigneeState = "typing";
        const fullText = "Buil";
        typedText = fullText.substring(0, typingChars);
      } else if (dropdownP > 0) {
        assigneeState = "dropdown";
      }

      return (
        <AbsoluteFill style={{ backgroundColor: "#0a0a0a" }}>
          <JiraLayout
            width={width}
            height={height}
            // Assignee animation
            assigneeState={assigneeState}
            assigneeDropdownProgress={dropdownOpacity}
            typedText={typedText}
            // Comment animations
            showFirstComment={firstCommentP > 0}
            showSecondComment={secondCommentP > 0}
            firstCommentSpring={firstCommentSpring}
            secondCommentSpring={secondCommentSpring}
          />
        </AbsoluteFill>
      );
    },
  });
