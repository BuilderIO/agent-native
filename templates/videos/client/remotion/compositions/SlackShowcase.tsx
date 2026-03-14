/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SLACK SHOWCASE COMPOSITION - EPIC ANIMATION SEQUENCE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Animation Timeline:
 * 1. Slack interface fades in (thread panel closed)
 * 2. Cursor moves to message input
 * 3. Diego types "@Bui" character by character
 * 4. Mention autocomplete fades in
 * 5. Cursor hits Enter, autocomplete disappears
 * 6. Text completes, Diego sends message
 * 7. Message appears, thread indicator springs in
 * 8. Cursor clicks thread, panel slides open
 * 9. Cursor moves to "View in Builder.io" button and clicks
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";
import type { AnimationTrack } from "@/types";
import { findTrack, trackProgress, getPropValue } from "../trackAnimation";
import { createInteractiveComposition } from "../hooks/createInteractiveComposition";
import { useInteractiveComponent, AnimationPresets } from "../hooks/useInteractiveComponent";
import { SlackUI } from "../slack-components/SlackUI";
import { createCameraTrack } from "../trackHelpers";

export type SlackShowcaseProps = {
  tracks?: AnimationTrack[];
};

const TOTAL_FRAMES = 600;

const FALLBACK_TRACKS: AnimationTrack[] = [
  createCameraTrack(TOTAL_FRAMES),
  
  // Cursor animation
  {
    id: "cursor",
    label: "Cursor",
    startFrame: 0,
    endFrame: TOTAL_FRAMES,
    easing: "expo.inOut",
    animatedProps: [
      {
        property: "x",
        from: "960",
        to: "960",
        unit: "px",
        keyframes: [
          { frame: 0, value: "960" },
          { frame: 60, value: "960" },
          { frame: 90, value: "650" },  // Move to message input (1.5s)
          { frame: 250, value: "650" },  // Stay during typing
          { frame: 280, value: "650" },  // Stay at input after send
          { frame: 355, value: "600" },  // Move to thread indicator
          { frame: 375, value: "600" },  // Hover over thread indicator
          { frame: 465, value: "1530" }, // Move to Builder button
          { frame: 600, value: "1530" },
        ]
      },
      {
        property: "y",
        from: "540",
        to: "540",
        unit: "px",
        keyframes: [
          { frame: 0, value: "200" },
          { frame: 60, value: "200" },
          { frame: 90, value: "950" },  // Move to message input (1.5s)
          { frame: 250, value: "950" },  // Stay during typing
          { frame: 280, value: "950" },  // Stay at input after send
          { frame: 355, value: "930" },  // Move to thread indicator
          { frame: 375, value: "930" },  // Hover over thread indicator
          { frame: 465, value: "680" },  // Move to Builder button
          { frame: 600, value: "680" },
        ]
      },
      {
        property: "opacity",
        from: "1",
        to: "1",
        unit: "",
        keyframes: [
          { frame: 0, value: "1" },
          { frame: 590, value: "1" },
          { frame: 600, value: "0" },
        ]
      },
      {
        property: "type",
        from: "default",
        to: "default",
        unit: "",
        keyframes: [
          { frame: 0, value: "default" },
          { frame: 219, value: "pointer" },
          { frame: 281, value: "default" },
        ]
      },
      {
        property: "isClicking",
        from: "0",
        to: "0",
        unit: "",
        keyframes: [
          { frame: 160, value: "1" },  // Click to accept mention
          { frame: 170, value: "0" },
          { frame: 375, value: "1" },  // Click thread indicator
          { frame: 385, value: "0" },
          { frame: 590, value: "1" },  // Click Builder button
          { frame: 600, value: "0" },
        ]
      },
    ],
  },

  // Slack entrance - removed, start immediately visible
  {
    id: "slack-entrance",
    label: "Slack Entrance",
    startFrame: 0,
    endFrame: 1,
    easing: "linear",
    animatedProps: [
      { property: "opacity", from: "1", to: "1", unit: "" },
      { property: "translateY", from: "0", to: "0", unit: "px" },
      { property: "scale", from: "1", to: "1", unit: "" },
    ],
  },

  // Typing animation - starts at 1.5 seconds (90 frames at 60fps)
  {
    id: "typing",
    label: "Typing Animation",
    startFrame: 90,
    endFrame: 250,
    easing: "linear",
    animatedProps: [
      {
        property: "progress",
        from: "0",
        to: "1",
        unit: "",
        keyframes: [
          { frame: 90, value: "0" },          // Start typing
          { frame: 95, value: "0.01" },       // Type "@" (1 char)
          { frame: 115, value: "0.01" },       // PAUSE for 20 frames - show all profiles!
          { frame: 250, value: "1" },          // Continue typing rest of message
        ]
      },
    ],
  },

  // Mention autocomplete - appears at frame 95, disappears when "B" is typed
  {
    id: "mention-autocomplete",
    label: "Mention Autocomplete",
    startFrame: 95,
    endFrame: 210,
    easing: "power2.out",
    animatedProps: [
      {
        property: "visible",
        from: "1",
        to: "1",
        unit: "",
      },
    ],
  },

  // Thread panel slide
  {
    id: "thread-panel",
    label: "Thread Panel",
    startFrame: 375,
    endFrame: 435,
    easing: "expo.inOut",
    animatedProps: [
      {
        property: "slideProgress",
        from: "0",
        to: "1",
        unit: "",
      },
    ],
  },
];

export const SlackShowcase = createInteractiveComposition<SlackShowcaseProps>({
  fallbackTracks: FALLBACK_TRACKS,

  render: ({ cursorHistory, tracks, registerForCursor }, props) => {
    const frame = useCurrentFrame();
    const { fps, width, height } = useVideoConfig();

    // Find tracks
    const entranceTrack = findTrack(tracks, "slack-entrance", FALLBACK_TRACKS[2]);
    const typingTrack = findTrack(tracks, "typing", FALLBACK_TRACKS[3]);
    const mentionTrack = findTrack(tracks, "mention-autocomplete", FALLBACK_TRACKS[4]);
    const threadTrack = findTrack(tracks, "thread-panel", FALLBACK_TRACKS[5]);

    // Entrance animation
    const entranceP = trackProgress(frame, fps, entranceTrack);
    const entranceOpacity = getPropValue(entranceP, entranceTrack, "opacity", 0, 1);
    const entranceY = getPropValue(entranceP, entranceTrack, "translateY", 40, 0);
    const entranceScale = getPropValue(entranceP, entranceTrack, "scale", 0.95, 1);

    // Typing animation - REBUILT with explicit frame control
    const fullMessage = "@Builder.io Can you help me build a dashboard for our sales attribution for the Q4 2025 range with stats broken down per sales rep?";

    let typedText = "";
    let showMentionPill = false;

    if (frame >= 90 && frame < 255) {
      // Phase 1: Type "@" (frames 90-95)
      if (frame >= 90 && frame < 95) {
        typedText = "@";
      }
      // Phase 2: PAUSE showing just "@" (frames 95-115)
      else if (frame >= 95 && frame < 115) {
        typedText = "@";
      }
      // Phase 3: Type "Builder.io" (frames 115-140)
      else if (frame >= 115 && frame < 140) {
        const builderText = "Builder.io";
        const charsToType = Math.floor(interpolate(frame, [115, 140], [1, builderText.length + 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }));
        typedText = "@" + builderText.slice(0, charsToType);
      }
      // Phase 4: PAUSE with "@Builder.io" (frames 140-160)
      else if (frame >= 140 && frame < 160) {
        typedText = "@Builder.io";
      }
      // Phase 5: Transform to mention pill - start with empty text (frame 160+)
      else if (frame >= 160 && frame < 165) {
        showMentionPill = true;
        typedText = "";
      }
      // Phase 6: Continue typing rest of message (frames 165-250)
      else if (frame >= 165 && frame < 250) {
        showMentionPill = true;
        const restOfMessage = " Can you help me build a dashboard for our sales attribution for the Q4 2025 range with stats broken down per sales rep?";
        const charsToType = Math.floor(interpolate(frame, [165, 250], [0, restOfMessage.length], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }));
        typedText = restOfMessage.slice(0, charsToType);
      }
      // Phase 7: Show complete message (frames 250-255)
      else if (frame >= 250 && frame < 255) {
        showMentionPill = true;
        typedText = " Can you help me build a dashboard for our sales attribution for the Q4 2025 range with stats broken down per sales rep?";
      }
    }

    // Mention autocomplete - appears at frame 95, disappears at frame 160 when mention pill appears
    const showMentionAutocomplete = frame >= 95 && frame < 160;

    // Instant appearance - quick fade out when mention transforms (frames 160-165)
    const mentionOpacity = frame >= 95 && frame < 160
      ? 1
      : frame >= 160 && frame <= 165
      ? interpolate(frame, [160, 165], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
      : 0;

    // Mention pill spring animation - pops in when pill appears at frame 160
    const mentionPillSpring = showMentionPill
      ? spring({
          frame: frame - 160,
          fps,
          config: {
            damping: 12,
            stiffness: 200,
            mass: 0.6,
          },
        })
      : 0;

    // Define all mention options - shown when "@" is first typed
    const allMentionOptions = [
      {
        avatar: "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/fb1e1e3359a5886deb33a4b219cc295590c17bbb",
        name: "Builder.io",
        type: "bot" as const,
      },
      {
        avatar: "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/142cbada6c9a1e1765e83eed51088e3cca4d3067",
        name: "Amelia Gordon 🍎",
        type: "person" as const,
      },
      {
        avatar: "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/b66cecca9f47c8e283bea7334ed7658019b2c15d",
        name: "Diego Hernández 👨‍💻",
        type: "person" as const,
      },
      {
        avatar: "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/d98b788ade4bdaeacda5b41f4f74a2d4f11b2fe7",
        name: "Jeanne Thomas 🎨",
        type: "person" as const,
      },
      {
        avatar: "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/278c3a3a19450b3d5a7669ac7fa91cb8897e5a31",
        name: "Johnathan Silva",
        type: "person" as const,
      },
      {
        avatar: "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/862aa22e4f8bc58a7866e05b1b45847e983508cc",
        name: "Kyle Denver 🏗️",
        type: "person" as const,
      },
    ];

    // Filter options based on what comes after "@"
    // Frames 125-165: Just "@" typed - show ALL 6 profiles
    // Frames 165+: "@B..." typed - filter to names starting with "B"
    const mentionQuery = typedText.replace("@", "").split(" ")[0]; // Get text after @ before space
    const filteredMentionOptions = mentionQuery.length > 0 && mentionQuery !== ""
      ? allMentionOptions.filter(opt =>
          opt.name.toLowerCase().startsWith(mentionQuery.toLowerCase())
        )
      : allMentionOptions;

    // Diego's message visibility and spring animation - appears at frame 280
    const showDiegoMessage = frame >= 280;
    const diegoMessageSpring = showDiegoMessage
      ? spring({
          frame: frame - 280,
          fps,
          config: {
            damping: 18,
            stiffness: 250,
            mass: 0.8,
          },
        })
      : 0;

    const diegoMessageOpacity = diegoMessageSpring;
    const diegoMessageScale = 0.92 + (diegoMessageSpring * 0.08); // Scale from 0.92 to 1
    const diegoMessageY = (1 - diegoMessageSpring) * 20; // Slide up 20px

    // Existing messages spring up, then back down to natural position
    // Create a "bump" animation: starts at 0, peaks at -10, settles back to 0
    const messageSpringValue = showDiegoMessage
      ? spring({
          frame: frame - 280,
          fps,
          config: {
            damping: 20,
            stiffness: 180,
            mass: 1.2,
          },
        })
      : 0;

    // Create parabolic bump: 0 -> -10 -> 0
    // Uses spring * (1 - spring) to create a bump that starts and ends at 0
    const existingMessagesY = -10 * messageSpringValue * (1 - messageSpringValue) * 4;

    // Thread panel animation - width grows from 0 to full
    const threadP = trackProgress(frame, fps, threadTrack);
    const threadSlideProgress = getPropValue(threadP, threadTrack, "slideProgress", 0, 1);

    // Thread indicator appears after a longer pause (frame 325) and springs in
    const showThreadIndicator = frame >= 325;
    const threadIndicatorSpring = showThreadIndicator
      ? spring({
          frame: frame - 325,
          fps,
          config: {
            damping: 16,
            stiffness: 180,
            mass: 0.9,
          },
        })
      : 0;

    const threadIndicatorScale = threadIndicatorSpring;
    const threadIndicatorOpacity = threadIndicatorSpring;

    // Layout calculations
    const slackWidth = 1920;
    const slackHeight = 1080;
    const slackX = (width - slackWidth) / 2;
    const slackY = (height - slackHeight) / 2;

    // ═══ INTERACTIVE ELEMENTS ═══
    
    // Message input
    const messageInput = useInteractiveComponent({
      id: "message-input",
      elementType: "Input",
      label: "Message Input",
      compositionId: "slack-showcase",
      zone: { x: slackX + 480, y: slackY + 920, width: 600, height: 80 },
      cursorHistory,
      interactiveElementType: "input",
      hoverAnimation: AnimationPresets.scaleHover(0.01),
    });

    // Thread indicator (on Diego's message) - positioned at the bottom since messages scroll to bottom
    const threadIndicator = useInteractiveComponent({
      id: "thread-indicator",
      elementType: "Button",
      label: "Thread Indicator",
      compositionId: "slack-showcase",
      zone: { x: slackX + 480, y: slackY + 920, width: 250, height: 35 },
      cursorHistory,
      interactiveElementType: "button",
      hoverAnimation: AnimationPresets.scaleHover(0.05),
    });

    // View Builder.io button
    const viewBuilderButton = useInteractiveComponent({
      id: "view-builder-button",
      elementType: "Button",
      label: "View in Builder.io",
      compositionId: "slack-showcase",
      zone: { x: slackX + 1456, y: slackY + 653, width: 146, height: 33 },
      cursorHistory,
      interactiveElementType: "button",
      hoverAnimation: AnimationPresets.scaleHover(0.08),
    });

    // Register elements
    registerForCursor(messageInput);
    registerForCursor(threadIndicator);
    registerForCursor(viewBuilderButton);

    return (
      <AbsoluteFill style={{ backgroundColor: "#0a0a0a" }}>
        {/* Slack UI with entrance animation */}
        <div
          style={{
            position: "absolute",
            left: slackX,
            top: slackY,
            opacity: entranceOpacity,
            transform: `translateY(${entranceY}px) scale(${entranceScale})`,
            transformOrigin: "center center",
          }}
        >
          <SlackUI
            width={slackWidth}
            height={slackHeight}
            currentFrame={frame}
            threadPanelSlideProgress={threadSlideProgress}
            typedText={typedText}
            showMentionPill={showMentionPill}
            mentionPillSpring={mentionPillSpring}
            showMentionAutocomplete={showMentionAutocomplete}
            mentionAutocompleteOpacity={mentionOpacity}
            mentionAutocompleteOptions={filteredMentionOptions}
            mentionSearchTerm={mentionQuery}
            showDiegoMessage={showDiegoMessage}
            diegoMessageOpacity={diegoMessageOpacity}
            diegoMessageScale={diegoMessageScale}
            diegoMessageY={diegoMessageY}
            showThreadIndicator={showThreadIndicator}
            threadIndicatorOpacity={threadIndicatorOpacity}
            threadIndicatorHoverProgress={threadIndicator.hover.progress}
            existingMessagesY={existingMessagesY}
            builderButtonHoverProgress={viewBuilderButton.hover.progress}
          />
        </div>

        {/* Debug info */}
        {false && (
          <div
            style={{
              position: "absolute",
              top: 20,
              left: 20,
              color: "white",
              fontSize: 14,
              fontFamily: "monospace",
              background: "rgba(0,0,0,0.8)",
              padding: "12px",
              borderRadius: "6px",
              maxWidth: 400,
            }}
          >
            <div style={{ fontWeight: "bold", marginBottom: 8 }}>MENTION DEBUG</div>
            <div>Frame: {frame}</div>
            <div>Typed Text: "{typedText}"</div>
            <div>Mention Query: "{mentionQuery}"</div>
            <div>Show Autocomplete: {showMentionAutocomplete ? "YES" : "NO"}</div>
            <div>Autocomplete Opacity: {mentionOpacity.toFixed(2)}</div>
            <div>Total Options Available: {allMentionOptions.length}</div>
            <div>Filtered Options Showing: {filteredMentionOptions.length}</div>
            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
              {filteredMentionOptions.map((opt, i) => (
                <div key={i}>• {opt.name}</div>
              ))}
            </div>
          </div>
        )}
      </AbsoluteFill>
    );
  },
});
