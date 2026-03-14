import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring } from "remotion";
import { TransitionSeries, springTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { createInteractiveComposition } from "@/remotion/hooks/createInteractiveComposition";
import { findTrack, trackProgress, getPropValue } from "../trackAnimation";
import type { AnimationTrack } from "@/types";
import { JiraLayout } from "../library-components/JiraLayout";
import { SlackThreadPanel } from "../slack-components/SlackThreadPanel";
import { StandardView } from "../library-components/StandardView";

export type SixtySecondBlankProps = {
  backgroundColor?: string;
  accentColor?: string;
};

const FALLBACK_TRACKS: AnimationTrack[] = [
  {
    id: "camera",
    label: "Camera",
    startFrame: 0,
    endFrame: 1800,
    easing: "linear",
    animatedProps: [
      { property: "translateX", from: "0", to: "0", unit: "px", keyframes: [] },
      { property: "translateY", from: "0", to: "0", unit: "px", keyframes: [] },
      { property: "scale", from: "1", to: "1", unit: "", keyframes: [] },
      { property: "rotateX", from: "0", to: "0", unit: "deg", keyframes: [] },
      { property: "rotateY", from: "0", to: "0", unit: "deg", keyframes: [] },
      { property: "perspective", from: "800", to: "800", unit: "px", keyframes: [] },
    ],
  },
  {
    id: "cursor",
    label: "Cursor",
    startFrame: 0,
    endFrame: 1800,
    easing: "expo.inOut",
    animatedProps: [
      { property: "x", from: "960", to: "960", unit: "px", keyframes: [
        { frame: 0, value: "300" },
        { frame: 30, value: "1090" }
      ]},
      { property: "y", from: "540", to: "540", unit: "px", keyframes: [
        { frame: 0, value: "540" },
        { frame: 30, value: "540" }
      ]},
      { property: "opacity", from: "1", to: "1", unit: "", keyframes: [
        { frame: 0, value: "1" }
      ]},
      { property: "scale", from: "1", to: "1", unit: "", keyframes: [] },
      { property: "type", from: "default", to: "default", unit: "" },
      { property: "isClicking", from: "0", to: "0", unit: "", keyframes: [
        { frame: 35, value: "1" }
      ]},
    ],
  },
  {
    id: "typing-reveal",
    label: "Typing Builder 2.0",
    startFrame: 60,
    endFrame: 120,
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
    id: "claude-cursor",
    label: "Claude Cursor",
    startFrame: 141,
    endFrame: 230,
    easing: "spring",
    animatedProps: [
      { property: "x", from: "-400", to: "90", unit: "px", keyframes: [] },
      { property: "y", from: "1080", to: "10", unit: "px", keyframes: [] },
      { property: "opacity", from: "1", to: "1", unit: "", keyframes: [] },
    ],
  },
  {
    id: "codex-cursor",
    label: "Codex Cursor",
    startFrame: 141,
    endFrame: 230,
    easing: "spring",
    animatedProps: [
      { property: "x", from: "1720", to: "470", unit: "px", keyframes: [] },
      { property: "y", from: "1080", to: "10", unit: "px", keyframes: [] },
      { property: "opacity", from: "1", to: "1", unit: "", keyframes: [] },
    ],
  },
  {
    id: "jira-sidebar",
    label: "Jira Sidebar",
    startFrame: 165,
    endFrame: 240,
    easing: "expo.inOut",
    animatedProps: [
      { property: "x", from: "-650", to: "0", unit: "px", keyframes: [
        { frame: 175, value: "0", easing: "expo.inOut" }
      ] },
      { property: "opacity", from: "1", to: "1", unit: "", keyframes: [] },
    ],
  },
  {
    id: "works-text",
    label: "Works Text",
    startFrame: 226,
    endFrame: 320,
    easing: "linear",
    animatedProps: [
      { property: "y", from: "30", to: "0", unit: "px", keyframes: [] },
      { property: "opacity", from: "0", to: "1", unit: "", keyframes: [
        { frame: 234, value: "1", easing: "linear" }
      ] },
    ],
  },
  {
    id: "where-you-text",
    label: "Where You Text",
    startFrame: 272,
    endFrame: 320,
    easing: "linear",
    animatedProps: [
      { property: "y", from: "30", to: "0", unit: "px", keyframes: [] },
      { property: "opacity", from: "0", to: "1", unit: "", keyframes: [
        { frame: 287, value: "1", easing: "linear" }
      ] },
    ],
  },
  {
    id: "work-text",
    label: "Work Text",
    startFrame: 290,
    endFrame: 320,
    easing: "linear",
    animatedProps: [
      { property: "y", from: "30", to: "0", unit: "px", keyframes: [] },
      { property: "opacity", from: "0", to: "1", unit: "", keyframes: [
        { frame: 305, value: "1", easing: "linear" }
      ] },
    ],
  },
  {
    id: "team-collab-typing",
    label: "Full Team Collaboration Typing",
    startFrame: 336,
    endFrame: 380,
    easing: "linear",
    animatedProps: [
      { property: "progress", from: "0", to: "1", unit: "", keyframes: [] },
    ],
  },
  {
    id: "second-avatar",
    label: "Second Avatar",
    startFrame: 350,
    endFrame: 365,
    easing: "spring",
    animatedProps: [
      { property: "x", from: "-75", to: "0", unit: "px", keyframes: [] },
      { property: "opacity", from: "0", to: "1", unit: "", keyframes: [] },
    ],
  },
  {
    id: "third-avatar",
    label: "Third Avatar",
    startFrame: 370,
    endFrame: 385,
    easing: "spring",
    animatedProps: [
      { property: "x", from: "-75", to: "0", unit: "px", keyframes: [] },
      { property: "opacity", from: "0", to: "1", unit: "", keyframes: [] },
    ],
  },
  {
    id: "fourth-avatar",
    label: "Fourth Avatar",
    startFrame: 375,
    endFrame: 390,
    easing: "spring",
    animatedProps: [
      { property: "x", from: "-75", to: "0", unit: "px", keyframes: [] },
      { property: "opacity", from: "0", to: "1", unit: "", keyframes: [] },
    ],
  },
  {
    id: "alex-cursor-move",
    label: "Alex Cursor Move",
    startFrame: 400,
    endFrame: 420,
    easing: "expo.inOut",
    animatedProps: [
      { property: "x", from: "20", to: "57", unit: "%", keyframes: [] },
      { property: "y", from: "60", to: "32", unit: "%", keyframes: [] },
    ],
  },
  {
    id: "alex-cursor-click",
    label: "Alex Cursor Click",
    startFrame: 419,
    endFrame: 424,
    easing: "linear",
    animatedProps: [
      {
        property: "scale",
        from: "1",
        to: "1",
        unit: "",
        keyframes: [
          { frame: 419, value: "1" },
          { frame: 421, value: "0.85" },
          { frame: 424, value: "1" }
        ]
      },
    ],
  },
  {
    id: "data-click",
    label: "Data Click",
    startFrame: 420,
    endFrame: 425,
    easing: "linear",
    animatedProps: [
      { property: "outline", from: "0", to: "1", unit: "", keyframes: [] },
    ],
  },
  {
    id: "chart-transform",
    label: "Chart Transform",
    startFrame: 435,
    endFrame: 460,
    easing: "power2.inOut",
    animatedProps: [
      { property: "progress", from: "0", to: "1", unit: "", keyframes: [] },
    ],
  },
  {
    id: "cursor-fade-out",
    label: "Cursor Fade Out",
    startFrame: 500,
    endFrame: 515,
    easing: "linear",
    animatedProps: [
      { property: "opacity", from: "1", to: "0", unit: "", keyframes: [] },
    ],
  },
  {
    id: "chart-dehighlight",
    label: "Chart De-highlight",
    startFrame: 500,
    endFrame: 500,
    easing: "linear",
    animatedProps: [
      {
        property: "highlight",
        from: "",
        to: "",
        unit: "",
        programmatic: true,
        description: "Removes green outline from chart at frame 500",
      },
    ],
  },
  {
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
  },
  {
    id: "review-typing",
    label: "Get Your Changes Reviewed Typing",
    startFrame: 720,
    endFrame: 780,
    easing: "linear",
    animatedProps: [
      { property: "progress", from: "0", to: "1", unit: "", keyframes: [] },
    ],
  },
  {
    id: "fleet-typing",
    label: "Manage a Fleet of Agents Typing",
    startFrame: 1010,
    endFrame: 1070,
    easing: "linear",
    animatedProps: [
      { property: "progress", from: "0", to: "1", unit: "", keyframes: [] },
    ],
  },
  {
    id: "split-screen-1to2",
    label: "Split Screen 1 to 2",
    startFrame: 810,
    endFrame: 840,
    easing: "power2.inOut",
    animatedProps: [
      { property: "progress", from: "0", to: "1", unit: "", keyframes: [] },
    ],
  },
  {
    id: "split-screen-2to3",
    label: "Split Screen 2 to 3",
    startFrame: 880,
    endFrame: 910,
    easing: "power2.inOut",
    animatedProps: [
      { property: "progress", from: "0", to: "1", unit: "", keyframes: [] },
    ],
  },
  {
    id: "screen1-typing",
    label: "Screen 1 Typing",
    startFrame: 795,
    endFrame: 875,
    easing: "linear",
    animatedProps: [
      { property: "progress", from: "0", to: "1", unit: "", keyframes: [] },
    ],
  },
  {
    id: "screen2-typing",
    label: "Screen 2 Typing",
    startFrame: 825,
    endFrame: 920,
    easing: "linear",
    animatedProps: [
      { property: "progress", from: "0", to: "1", unit: "", keyframes: [] },
    ],
  },
  {
    id: "screen3-typing",
    label: "Screen 3 Typing",
    startFrame: 865,
    endFrame: 960,
    easing: "linear",
    animatedProps: [
      { property: "progress", from: "0", to: "1", unit: "", keyframes: [] },
    ],
  },
  {
    id: "collapse-to-kanban",
    label: "Collapse to Kanban Cards",
    startFrame: 970,
    endFrame: 1010,
    easing: "spring",
    animatedProps: [
      { property: "progress", from: "0", to: "1", unit: "", keyframes: [] },
    ],
  },
  {
    id: "kanban-cards-wave1",
    label: "Kanban Cards Wave 1",
    startFrame: 1020,
    endFrame: 1055,
    easing: "expo.out",
    animatedProps: [
      { property: "progress", from: "0", to: "1", unit: "", keyframes: [] },
    ],
  },
  {
    id: "kanban-cards-wave2",
    label: "Kanban Cards Wave 2",
    startFrame: 1040,
    endFrame: 1075,
    easing: "expo.out",
    animatedProps: [
      { property: "progress", from: "0", to: "1", unit: "", keyframes: [] },
    ],
  },
  {
    id: "kanban-cards-wave3",
    label: "Kanban Cards Wave 3",
    startFrame: 1060,
    endFrame: 1095,
    easing: "expo.out",
    animatedProps: [
      { property: "progress", from: "0", to: "1", unit: "", keyframes: [] },
    ],
  },
  {
    id: "works-anywhere-typing",
    label: "Works Anywhere Typing",
    startFrame: 764,
    endFrame: 804,
    easing: "linear",
    animatedProps: [
      { property: "progress", from: "0", to: "1", unit: "", keyframes: [] },
    ],
  },
  {
    id: "phone-slide-in",
    label: "Phone Slide In",
    startFrame: 770,
    endFrame: 800,
    easing: "expo.out",
    animatedProps: [
      { property: "x", from: "250", to: "0", unit: "px", keyframes: [] },
      { property: "opacity", from: "0", to: "1", unit: "", keyframes: [] },
    ],
  },
  {
    id: "phone2-rotate",
    label: "Phone 2 Rotate In",
    startFrame: 810,
    endFrame: 840,
    easing: "expo.out",
    animatedProps: [
      { property: "rotate", from: "0", to: "-15", unit: "deg", keyframes: [] },
      { property: "opacity", from: "0", to: "1", unit: "", keyframes: [] },
    ],
  },
  {
    id: "phone3-rotate",
    label: "Phone 3 Rotate In",
    startFrame: 820,
    endFrame: 850,
    easing: "expo.out",
    animatedProps: [
      { property: "rotate", from: "0", to: "-30", unit: "deg", keyframes: [] },
      { property: "opacity", from: "0", to: "1", unit: "", keyframes: [] },
    ],
  },
  {
    id: "send-pr-tap",
    label: "Send PR Tap Animation",
    startFrame: 816,
    endFrame: 836,
    easing: "power2.out",
    animatedProps: [
      { property: "scale", from: "0", to: "1", unit: "", keyframes: [] },
      { property: "opacity", from: "0.6", to: "0", unit: "", keyframes: [] },
    ],
  },
];

/**
 * SixtySecondBlank - 60-second composition using TransitionSeries
 *
 * Currently contains:
 * - Scene 1: "Announcing Builder 2.0" with typing animation (113 frames)
 * - Scene 2: Multiplayer coding (222 frames, ends at frame 335)
 * - Scene 3: Full team collaboration (starts at frame 336)
 *
 * Total duration: 1800 frames (60 seconds at 30fps)
 */
export const SixtySecondBlank = createInteractiveComposition<SixtySecondBlankProps>({
  fallbackTracks: FALLBACK_TRACKS,
  render: ({ cursorHistory, tracks, registerForCursor }, props) => {
    const { backgroundColor = "#000000", accentColor = "#1BBDF5" } = props;

    return (
      <AbsoluteFill style={{ backgroundColor }}>
        <TransitionSeries>
          {/* SCENE 1: Announcing Builder 2.0 (113 frames) */}
          <TransitionSeries.Sequence durationInFrames={113}>
            <Scene1Announcing accentColor={accentColor} tracks={tracks} />
          </TransitionSeries.Sequence>

          {/* SCENE 2: Multiplayer coding (222 frames, global 113-335) */}
          <TransitionSeries.Sequence durationInFrames={222}>
            <Scene2Blank accentColor={accentColor} backgroundColor={backgroundColor} tracks={tracks} />
          </TransitionSeries.Sequence>

          {/* SCENE 3: Full team collaboration (starts at global frame 336) */}
          <TransitionSeries.Sequence durationInFrames={1465}>
            <Scene3TeamCollaboration accentColor={accentColor} backgroundColor={backgroundColor} tracks={tracks} />
          </TransitionSeries.Sequence>
        </TransitionSeries>
      </AbsoluteFill>
    );
  },
});

/**
 * SCENE 1: Announcing Builder 2.0
 * The opening scene with typing animation
 */
const Scene1Announcing: React.FC<{ accentColor: string; tracks: AnimationTrack[] }> = ({
  accentColor,
  tracks
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Find typing track
  const typingTrack = findTrack(tracks, "typing-reveal", FALLBACK_TRACKS[2]);

  // Typing animation
  const typingP = trackProgress(frame, fps, typingTrack);
  const typedText = " Builder 2.0";
  const charsToShow = Math.floor(typingP * typedText.length);
  const visibleTypedText = typedText.slice(0, charsToShow);

  // Fade out animation (frames 95-104)
  const fadeOutStart = 95;
  const fadeOutEnd = 104;
  const opacity = frame < fadeOutStart
    ? 1
    : frame > fadeOutEnd
    ? 0
    : 1 - ((frame - fadeOutStart) / (fadeOutEnd - fadeOutStart));

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity,
      }}
    >
      <div
        style={{
          fontSize: 80,
          fontFamily: "'Inter', sans-serif",
          color: "#ffffff",
          fontWeight: 700,
          letterSpacing: "-0.02em",
          width: "80%",
          maxWidth: "1200px",
        }}
      >
        <span>Announcing</span>
        <span
          style={{
            background: "linear-gradient(to right, #18B6F4, #2EFCFE)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          {visibleTypedText}
        </span>

        {/* Blinking cursor during typing */}
        {typingP > 0 && typingP < 1 && (
          <span
            style={{
              marginLeft: 4,
              color: accentColor,
              opacity: Math.sin(frame * 0.3) > 0 ? 1 : 0,
            }}
          >
            |
          </span>
        )}
      </div>
    </AbsoluteFill>
  );
};

/**
 * SCENE 2: Multiplayer coding
 * Shows "Multiplayer coding" typing out, then two cursors fly in
 * from bottom corners carrying "Claude" and "Codex"
 */
const Scene2Blank: React.FC<{ accentColor: string; backgroundColor: string; tracks: AnimationTrack[] }> = ({
  accentColor,
  backgroundColor,
  tracks
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Scene 2 starts at global frame 113 (after Scene 1's 113 frames)
  const globalFrame = frame + 113;

  // Typing animation for "Multiplayer coding with" (frames 0-30 of Scene 2)
  const typingText = "Multiplayer coding with";
  const typingDuration = 30; // 1 second
  const typingProgress = Math.min(frame / typingDuration, 1);
  const charsToShow = Math.floor(typingProgress * typingText.length);
  const visibleText = typingText.slice(0, charsToShow);

  // Find cursor tracks
  const claudeTrack = findTrack(tracks, "claude-cursor", FALLBACK_TRACKS[3]);
  const codexTrack = findTrack(tracks, "codex-cursor", FALLBACK_TRACKS[4]);

  // Get progress for each cursor track (using global frame since tracks use absolute frame numbers)
  const claudeProgress = trackProgress(globalFrame, fps, claudeTrack);
  const codexProgress = trackProgress(globalFrame, fps, codexTrack);

  // Get cursor positions from tracks
  const leftCursorX = getPropValue(claudeProgress, claudeTrack, "x", -400, 90);
  const leftCursorY = getPropValue(claudeProgress, claudeTrack, "y", 1080, 10);
  const claudeOpacity = getPropValue(claudeProgress, claudeTrack, "opacity", 1, 1);

  const rightCursorX = getPropValue(codexProgress, codexTrack, "x", 1720, 470);
  const rightCursorY = getPropValue(codexProgress, codexTrack, "y", 1080, 10);
  const codexOpacity = getPropValue(codexProgress, codexTrack, "opacity", 1, 1);

  // Jira sidebar track
  const jiraSidebarTrack = findTrack(tracks, "jira-sidebar", FALLBACK_TRACKS[5]);
  const jiraSidebarProgress = trackProgress(globalFrame, fps, jiraSidebarTrack);
  const jiraSidebarX = getPropValue(jiraSidebarProgress, jiraSidebarTrack, "x", -650, 0);
  const jiraSidebarOpacity = getPropValue(jiraSidebarProgress, jiraSidebarTrack, "opacity", 1, 1);

  // Text animation tracks
  const worksTextTrack = findTrack(tracks, "works-text", FALLBACK_TRACKS[6]);
  const worksTextProgress = trackProgress(globalFrame, fps, worksTextTrack);
  const worksTextY = getPropValue(worksTextProgress, worksTextTrack, "y", 30, 0);
  const worksTextOpacity = getPropValue(worksTextProgress, worksTextTrack, "opacity", 0, 1);

  const whereYouTextTrack = findTrack(tracks, "where-you-text", FALLBACK_TRACKS[7]);
  const whereYouTextProgress = trackProgress(globalFrame, fps, whereYouTextTrack);
  const whereYouTextY = getPropValue(whereYouTextProgress, whereYouTextTrack, "y", 30, 0);
  const whereYouTextOpacity = getPropValue(whereYouTextProgress, whereYouTextTrack, "opacity", 0, 1);

  const workTextTrack = findTrack(tracks, "work-text", FALLBACK_TRACKS[8]);
  const workTextProgress = trackProgress(globalFrame, fps, workTextTrack);
  const workTextY = getPropValue(workTextProgress, workTextTrack, "y", 30, 0);
  const workTextOpacity = getPropValue(workTextProgress, workTextTrack, "opacity", 0, 1);

  // Show cursors when opacity is greater than 0
  const showCursors = claudeOpacity > 0 || codexOpacity > 0;

  // Calculate progress for plus sign (show when cursors are halfway)
  const cursorStartFrame = claudeTrack.startFrame;
  const cursorDuration = claudeTrack.endFrame - claudeTrack.startFrame;
  const cursorProgress = globalFrame >= cursorStartFrame
    ? Math.min((globalFrame - cursorStartFrame) / cursorDuration, 1)
    : 0;

  // Fade out multiplayer coding section from frames 189-197
  const fadeOutOpacity = globalFrame < 189 ? 1 :
    globalFrame < 197 ? 1 - (globalFrame - 189) / 8 :
    0;

  // Fade to black at end of Scene 2 (frames 325-335)
  const sceneFadeOut = globalFrame < 325 ? 0 :
    globalFrame < 335 ? (globalFrame - 325) / 10 :
    1;

  return (
    <AbsoluteFill style={{ backgroundColor }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          fontFamily: "'Inter', sans-serif",
        }}
      >
        {/* Main title "Multiplayer coding" */}
        <div
          style={{
            fontSize: 80,
            color: "#ffffff",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            marginBottom: 40,
            opacity: fadeOutOpacity,
          }}
        >
          {visibleText}
          {/* Blinking cursor during typing */}
          {typingProgress > 0 && typingProgress < 1 && (
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

        {/* Subtitle area - "Claude + Codex" */}
        <div style={{ position: "relative", height: 100, width: 800 }}>
          {/* Left cursor with "Claude" */}
          {showCursors && (
            <>
              <div
                style={{
                  position: "absolute",
                  left: leftCursorX,
                  top: leftCursorY,
                  backgroundColor: "rgba(255, 255, 255, 0.1)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  borderRadius: 12,
                  padding: "20px 40px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: 80,
                  opacity: claudeOpacity * fadeOutOpacity,
                }}
              >
                <img
                  src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F65fe2970532b4e649c6dc4fc9225f0e8?format=webp&width=800&height=1200"
                  alt="Claude"
                  style={{ height: 40 }}
                />
              </div>
              {/* Left cursor pointer */}
              <div
                style={{
                  position: "absolute",
                  left: leftCursorX + 120,
                  top: leftCursorY + 58,
                  opacity: globalFrame >= 170 ? 0 : claudeOpacity * fadeOutOpacity,
                }}
              >
                <svg height="64" width="64" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
                  <g fill="none" fillRule="evenodd" transform="translate(8 9)">
                    <path d="m3.44281398 1.68449726c-.74326136.27630142-1.05584685.8131257-1.07636853 1.38003696-.01344897.37336893.06665513.72649286.23114214 1.18694303-.02596219-.07267623.09676488.29282004.12116236.37362273.05052942.16918921-.4865367-.05865774-.81377307.00741883-.36363321.07113868-.84783757.38332307-1.10006887.79754775-.29643467.48542737-.3109609 1.04368567-.08235979 2.04824266.12491868.54736183.36572145 1.00836814.71076689 1.44594879.15329951.1944118.5713628.64726015.60307236.6875974l.84854343.94062339c.15080214.1358526.25794954.2361946.57590427.5380259.3147558.2987762.4647038.4380078.60308951.555976.05846214.0492474.10784267.1797116.12740685.3736249.01609788.1595565.01049553.3375341-.0090192.5090254-.00674888.0593077-.01325791.1020883-.01698742.1224696-.04189161.228932.13269563.4403386.36541902.4424835.21585671.0019894.38528595.0046546.82216479.0123538.09483476.0016698.09483476.0016698.18993053.0033129 1.16876447.0200186 1.75308289.0147904 2.17807912-.0385723.45429894-.0572869.92650915-.6110188 1.32698393-1.2957591.34289141.6108338.81859723 1.2057867 1.2995685 1.2820532.1510118.0244148.3353555.0322555.548787.0275887.1606725-.0035131.3307029-.0140241.5021961-.0293376.1276907-.0114022.2293359-.0228648.29003-.0307451.2258836-.0293282.373669-.251611.3133108-.4712481-.0130351-.0474332-.0339838-.1345011-.0551094-.2441635-.0245945-.1276687-.0423383-.2523857-.0503381-.365988-.0050217-.0713101-.0059948-.1359317-.0027687-.1918983.0059157-.0980798.0077938-.1530073.0108033-.281125.0010795-.0448938.0010795-.0448938.0024606-.0845172.0054208-.1364475.0233824-.2649146.0815132-.544638.0250088-.1201275.1473169-.352189.3398902-.639435.0571394-.0852302.1195783-.1742239.1864664-.26609712.1272143-.17473362.2641361-.35131772.4011075-.52030772.082051-.10123129.145482-.17695689.1808122-.21807676.2967593-.42378347.612817-1.11823437.7291396-1.52536348.1117407-.39153936.202351-1.12501196.254373-1.81690429.029923-.39968605.0410555-.72381216.0410555-1.23011613.0000742-.09758414.0000742-.09758414.0002975-.17670236.0003569-.11115478.0003569-.11115478.000115-.20711835-.0008934-.15683883-.0055282-.31323355-.0207085-.69507578-.0313109-.81293139-.4771727-1.33911388-1.1344906-1.44058831-.559108-.08631314-1.0586051.08188477-1.2779293.31625977-.0755526.08073733.0036753-.2781823-.2159489-.62316278-.1644465-.25841586-.593184-.58905957-.9209287-.65355552-.335487-.06535532-.73539548-.05811715-1.1017193.00667481-.32093157.05742909-.68608434.33741751-.87176225.64688068-.12411885.20686477.03884667-.00592296-.09368743-.23401341-.18231052-.31422641-.60754287-.59486422-1.01411454-.67799709-.34643562-.07139428-.74182572-.04452925-1.09945614.0633873-.43336319.1291117-1.01795827.61460976-.94899189 1.15552627-.34375-.54091651-1.25026717-.691379-1.97906097-.42111797z" fill="#000"/>
                    <path d="m7.31951013 1.62138197c.20710357.04234751.44724204.20083012.51632974.31990811.08404358.1446387.15562749.36413806.21048667.6366124.02933373.14569467.12179446 1.2125285.29383112 1.32370243.41279229.04533731.41279229.04533731.52658055-.12364345.03545705-.07383858.03545705-.07383858.04226523-.1029106.01416796-.06009544.02463332-.12677987.0351322-.21754028l.00854738-.07915386.00047673-.00942804.00327525-.03167185c.01085148-.11424313.04184125-.4312127.05388392-.53034902.03788792-.31189663.08766449-.52757784.13944093-.6138719.0713024-.11883734.31942298-.28274442.43149612-.30279961.2804398-.04960082.58940103-.05519288.82623993-.00905543.1084394.02134018.3709471.22378689.432331.32024744.1291079.20279957.2524316.84889766.3225486 1.4970065-.0102194.04624251-.0102194.04624251.1640069.28984194.5843296-.06677889.5843296-.06677889.5703629-.17490247.0159511-.03856429.0284824-.08294031.045969-.15118961.0423876-.16089067.0697594-.25204451.111066-.35549917.0288558-.07227096.0592914-.13391873.0904889-.18278042.1209187-.19031132.4335712-.319392.7077174-.27707028.2943447.04543991.4816904.26653537.4994912.72869815.0148821.37434892.0193146.5239164.0201469.6700184l-.0004247.37954865c0 .48831141-.0104951.79388164-.0389535 1.17400348-.0480918.63962116-.1348512 1.34192123-.227649 1.66708484-.0946325.33121345-.3766371.95084197-.6003915 1.27298482-.0161892.01580846-.0841508.09694273-.1710333.20413492-.1445842.17838247-.2892181.36491271-.4247891.5511244-.0723398.09936149-.1402862.19620479-.2030964.2898938-.2440054.36396314-.400553.66098894-.4512157.90434304-.0659304.3172546-.0893838.4850003-.0966379.6675968-.0017072.0490782-.0017072.0490782-.002845.096677-.0028064.119476-.004437.1671639-.0097087.2545848-.0052654.091322-.0038193.187354.00332.2887353.0103318.1467182.1058713.3478531.1058713.3478531s-.2321503-.0119819-.3742084-.0088758c-.1718098.0037567-.3147843-.0023244-.4138162-.0183342-.1440353-.0228411-.53014068-.5057331-.7278511-.8821737-.30227042-.5764228-1.03604858-.5484427-1.33684295-.0394061-.26854779.4591613-.65918083.9172326-.7740684.9317199-.37404082.0469647-.94643778.0520862-2.07160079.0328144-.09480875-.0016381-.46003446-.0128683-.64600494-.0157445-.18597048-.0028763.05008807-.1790283.02786486-.399297-.03726222-.36933-.15125405-.6704984-.38877094-.8705429-.12241569-.1043631-.26774964-.2393104-.56509654-.5215613-.33323493-.3163366-.44236499-.4185353-.57290215-.533275l-.80130455-.89071892c-.03955779-.05174211-.45812831-.5051399-.5872217-.6688539-.28069963-.35597842-.47062947-.71959073-.56844755-1.14820437-.18921973-.83150113-.1793328-1.21146622-.00855589-1.49112273.13743587-.2257023.43815377-.4195862.60596039-.45241793.17165981-.03465512.55153059-.01648617.62179422.02229321.09902279.05401056.13357243.07300285.16379074.09097645.03572494.02124891.05965747.03799198.08182912.05708809.03426437.02951139.07235014.07170412.12420211.14044502.03611591.04821025.07806642.1053997.1423779.19304882.06054643.0816627.09183576.12069421.13369221.1590035.28038907.25662728.68391532.03238058.65052057-.32606956-.00567036-.06086415-.02203766-.12694598-.05458621-.23708502-.04356824-.15021272.00433013-.05284275-.26002629-.56642281-.08720664-.16942124-.13955864-.28835362-.17428227-.4046158l-.03412852-.10219113c-.03838756-.11059767-.09558223-.26854489-.12612861-.35199347l-.02009957-.05467087.002.008-.05974804-.17751191c-.09232236-.28807194-.13413567-.51358087-.12645475-.72681781.01040781-.28751553.16037753-.54506871.58790983-.70400047.40142488-.1488616 1.07786076.00117106 1.20581167.27856864.04319814.09369738.08927466.21199471.13900415.35457792l.03930997.11680217c.05539717.16759437.13470873.41493582.13860471.42816881.02724222.08344874.0471839.13860719.06943813.18441246.00217869.06301886.00217869.06301886.35429398.23177937.41699479-.29154152.41699479-.29154152.38019201-.37525838.00571063-.08773482.00758408-.17356287.00965287-.37317647.00242546-.23402898.00423842-.33154773.00994479-.45966208.01316411-.29554918.0437926-.51142116.09291227-.63864415.09160418-.23801371.25279279-.40993649.4432431-.46667832.24458613-.07380253.51465245-.09215236.73323569-.04710649zm1.21356228 4.27672201c-.20710459.00095412-.37422255.16961903-.37326843.37672361l.016 3.473c.00095412.20710459.16961903.37422251.37672361.37326841.20710459-.0009541.37422255-.16961901.37326843-.37672359l-.016-3.473c-.00095412-.20710459-.16961903-.37422255-.37672361-.37326843zm2.03332759.00229602c-.2071068 0-.375.16789322-.375.375v3.459c0 .20710678.1678932.375.375.375s.375-.16789322.375-.375v-3.459c0-.20710678-.1678932-.375-.375-.375zm-4.01399856.02930704c-.20710289.00126946-.37396385.17018863-.3726944.37729152l.021 3.426c.00126946.20710289.17018863.37396384.37729152.37269444.20710289-.0012695.37396385-.17018867.3726944-.37729156l-.021-3.426c-.00126946-.20710289-.17018863-.37396385-.37729152-.3726944z" fill="#fff"/>
                  </g>
                </svg>
              </div>
            </>
          )}

          {/* Plus sign */}
          {showCursors && cursorProgress > 0.5 && (
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: 0,
                transform: "translateX(calc(-50% + 10px))",
                fontSize: 60,
                fontWeight: 600,
                color: "#ffffff",
                opacity: fadeOutOpacity,
              }}
            >
              +
            </div>
          )}

          {/* Right cursor with "Codex" */}
          {showCursors && (
            <>
              <div
                style={{
                  position: "absolute",
                  left: rightCursorX,
                  top: rightCursorY,
                  backgroundColor: "rgba(255, 255, 255, 0.1)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  borderRadius: 12,
                  padding: "20px 40px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: 80,
                  fontSize: 36,
                  fontWeight: 600,
                  color: "#ffffff",
                  opacity: codexOpacity * fadeOutOpacity,
                }}
              >
                Codex
              </div>
              {/* Right cursor pointer */}
              <div
                style={{
                  position: "absolute",
                  left: rightCursorX + 68,
                  top: rightCursorY + 58,
                  opacity: globalFrame >= 170 ? 0 : codexOpacity * fadeOutOpacity,
                }}
              >
                <svg height="64" width="64" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
                  <g fill="none" fillRule="evenodd" transform="translate(8 9)">
                    <path d="m3.44281398 1.68449726c-.74326136.27630142-1.05584685.8131257-1.07636853 1.38003696-.01344897.37336893.06665513.72649286.23114214 1.18694303-.02596219-.07267623.09676488.29282004.12116236.37362273.05052942.16918921-.4865367-.05865774-.81377307.00741883-.36363321.07113868-.84783757.38332307-1.10006887.79754775-.29643467.48542737-.3109609 1.04368567-.08235979 2.04824266.12491868.54736183.36572145 1.00836814.71076689 1.44594879.15329951.1944118.5713628.64726015.60307236.6875974l.84854343.94062339c.15080214.1358526.25794954.2361946.57590427.5380259.3147558.2987762.4647038.4380078.60308951.555976.05846214.0492474.10784267.1797116.12740685.3736249.01609788.1595565.01049553.3375341-.0090192.5090254-.00674888.0593077-.01325791.1020883-.01698742.1224696-.04189161.228932.13269563.4403386.36541902.4424835.21585671.0019894.38528595.0046546.82216479.0123538.09483476.0016698.09483476.0016698.18993053.0033129 1.16876447.0200186 1.75308289.0147904 2.17807912-.0385723.45429894-.0572869.92650915-.6110188 1.32698393-1.2957591.34289141.6108338.81859723 1.2057867 1.2995685 1.2820532.1510118.0244148.3353555.0322555.548787.0275887.1606725-.0035131.3307029-.0140241.5021961-.0293376.1276907-.0114022.2293359-.0228648.29003-.0307451.2258836-.0293282.373669-.251611.3133108-.4712481-.0130351-.0474332-.0339838-.1345011-.0551094-.2441635-.0245945-.1276687-.0423383-.2523857-.0503381-.365988-.0050217-.0713101-.0059948-.1359317-.0027687-.1918983.0059157-.0980798.0077938-.1530073.0108033-.281125.0010795-.0448938.0010795-.0448938.0024606-.0845172.0054208-.1364475.0233824-.2649146.0815132-.544638.0250088-.1201275.1473169-.352189.3398902-.639435.0571394-.0852302.1195783-.1742239.1864664-.26609712.1272143-.17473362.2641361-.35131772.4011075-.52030772.082051-.10123129.145482-.17695689.1808122-.21807676.2967593-.42378347.612817-1.11823437.7291396-1.52536348.1117407-.39153936.202351-1.12501196.254373-1.81690429.029923-.39968605.0410555-.72381216.0410555-1.23011613.0000742-.09758414.0000742-.09758414.0002975-.17670236.0003569-.11115478.0003569-.11115478.000115-.20711835-.0008934-.15683883-.0055282-.31323355-.0207085-.69507578-.0313109-.81293139-.4771727-1.33911388-1.1344906-1.44058831-.559108-.08631314-1.0586051.08188477-1.2779293.31625977-.0755526.08073733.0036753-.2781823-.2159489-.62316278-.1644465-.25841586-.593184-.58905957-.9209287-.65355552-.335487-.06535532-.73539548-.05811715-1.1017193.00667481-.32093157.05742909-.68608434.33741751-.87176225.64688068-.12411885.20686477.03884667-.00592296-.09368743-.23401341-.18231052-.31422641-.60754287-.59486422-1.01411454-.67799709-.34643562-.07139428-.74182572-.04452925-1.09945614.0633873-.43336319.1291117-1.01795827.61460976-.94899189 1.15552627-.34375-.54091651-1.25026717-.691379-1.97906097-.42111797z" fill="#000"/>
                    <path d="m7.31951013 1.62138197c.20710357.04234751.44724204.20083012.51632974.31990811.08404358.1446387.15562749.36413806.21048667.6366124.02933373.14569467.12179446 1.2125285.29383112 1.32370243.41279229.04533731.41279229.04533731.52658055-.12364345.03545705-.07383858.03545705-.07383858.04226523-.1029106.01416796-.06009544.02463332-.12677987.0351322-.21754028l.00854738-.07915386.00047673-.00942804.00327525-.03167185c.01085148-.11424313.04184125-.4312127.05388392-.53034902.03788792-.31189663.08766449-.52757784.13944093-.6138719.0713024-.11883734.31942298-.28274442.43149612-.30279961.2804398-.04960082.58940103-.05519288.82623993-.00905543.1084394.02134018.3709471.22378689.432331.32024744.1291079.20279957.2524316.84889766.3225486 1.4970065-.0102194.04624251-.0102194.04624251.1640069.28984194.5843296-.06677889.5843296-.06677889.5703629-.17490247.0159511-.03856429.0284824-.08294031.045969-.15118961.0423876-.16089067.0697594-.25204451.111066-.35549917.0288558-.07227096.0592914-.13391873.0904889-.18278042.1209187-.19031132.4335712-.319392.7077174-.27707028.2943447.04543991.4816904.26653537.4994912.72869815.0148821.37434892.0193146.5239164.0201469.6700184l-.0004247.37954865c0 .48831141-.0104951.79388164-.0389535 1.17400348-.0480918.63962116-.1348512 1.34192123-.227649 1.66708484-.0946325.33121345-.3766371.95084197-.6003915 1.27298482-.0161892.01580846-.0841508.09694273-.1710333.20413492-.1445842.17838247-.2892181.36491271-.4247891.5511244-.0723398.09936149-.1402862.19620479-.2030964.2898938-.2440054.36396314-.400553.66098894-.4512157.90434304-.0659304.3172546-.0893838.4850003-.0966379.6675968-.0017072.0490782-.0017072.0490782-.002845.096677-.0028064.119476-.004437.1671639-.0097087.2545848-.0052654.091322-.0038193.187354.00332.2887353.0103318.1467182.1058713.3478531.1058713.3478531s-.2321503-.0119819-.3742084-.0088758c-.1718098.0037567-.3147843-.0023244-.4138162-.0183342-.1440353-.0228411-.53014068-.5057331-.7278511-.8821737-.30227042-.5764228-1.03604858-.5484427-1.33684295-.0394061-.26854779.4591613-.65918083.9172326-.7740684.9317199-.37404082.0469647-.94643778.0520862-2.07160079.0328144-.09480875-.0016381-.46003446-.0128683-.64600494-.0157445-.18597048-.0028763.05008807-.1790283.02786486-.399297-.03726222-.36933-.15125405-.6704984-.38877094-.8705429-.12241569-.1043631-.26774964-.2393104-.56509654-.5215613-.33323493-.3163366-.44236499-.4185353-.57290215-.533275l-.80130455-.89071892c-.03955779-.05174211-.45812831-.5051399-.5872217-.6688539-.28069963-.35597842-.47062947-.71959073-.56844755-1.14820437-.18921973-.83150113-.1793328-1.21146622-.00855589-1.49112273.13743587-.2257023.43815377-.4195862.60596039-.45241793.17165981-.03465512.55153059-.01648617.62179422.02229321.09902279.05401056.13357243.07300285.16379074.09097645.03572494.02124891.05965747.03799198.08182912.05708809.03426437.02951139.07235014.07170412.12420211.14044502.03611591.04821025.07806642.1053997.1423779.19304882.06054643.0816627.09183576.12069421.13369221.1590035.28038907.25662728.68391532.03238058.65052057-.32606956-.00567036-.06086415-.02203766-.12694598-.05458621-.23708502-.04356824-.15021272.00433013-.05284275-.26002629-.56642281-.08720664-.16942124-.13955864-.28835362-.17428227-.4046158l-.03412852-.10219113c-.03838756-.11059767-.09558223-.26854489-.12612861-.35199347l-.02009957-.05467087.002.008-.05974804-.17751191c-.09232236-.28807194-.13413567-.51358087-.12645475-.72681781.01040781-.28751553.16037753-.54506871.58790983-.70400047.40142488-.1488616 1.07786076.00117106 1.20581167.27856864.04319814.09369738.08927466.21199471.13900415.35457792l.03930997.11680217c.05539717.16759437.13470873.41493582.13860471.42816881.02724222.08344874.0471839.13860719.06943813.18441246.00217869.06301886.00217869.06301886.35429398.23177937.41699479-.29154152.41699479-.29154152.38019201-.37525838.00571063-.08773482.00758408-.17356287.00965287-.37317647.00242546-.23402898.00423842-.33154773.00994479-.45966208.01316411-.29554918.0437926-.51142116.09291227-.63864415.09160418-.23801371.25279279-.40993649.4432431-.46667832.24458613-.07380253.51465245-.09215236.73323569-.04710649zm1.21356228 4.27672201c-.20710459.00095412-.37422255.16961903-.37326843.37672361l.016 3.473c.00095412.20710459.16961903.37422251.37672361.37326841.20710459-.0009541.37422255-.16961901.37326843-.37672359l-.016-3.473c-.00095412-.20710459-.16961903-.37422255-.37672361-.37326843zm2.03332759.00229602c-.2071068 0-.375.16789322-.375.375v3.459c0 .20710678.1678932.375.375.375s.375-.16789322.375-.375v-3.459c0-.20710678-.1678932-.375-.375-.375zm-4.01399856.02930704c-.20710289.00126946-.37396385.17018863-.3726944.37729152l.021 3.426c.00126946.20710289.17018863.37396384.37729152.37269444.20710289-.0012695.37396385-.17018867.3726944-.37729156l-.021-3.426c-.00126946-.20710289-.17018863-.37396385-.37729152-.3726944z" fill="#fff"/>
                  </g>
                </svg>
              </div>
            </>
          )}
        </div>

        {/* Jira sidebar sliding from left (until frame 272) */}
        {jiraSidebarOpacity > 0 && globalFrame < 272 && (
          <div
            style={{
              position: "absolute",
              left: jiraSidebarX,
              top: 0,
              width: 650,
              height: 1080,
              overflow: "hidden",
              opacity: jiraSidebarOpacity,
              boxShadow: "4px 0 20px rgba(0, 0, 0, 0.3)",
            }}
          >
            <div style={{ transform: "translate(-1270px, -96px)" }}>
              <JiraLayout
                width={1920}
                height={1080}
                assigneeState={
                  globalFrame < 230 ? "unassigned" :
                  globalFrame < 250 ? "dropdown" :
                  globalFrame < 256 ? "typing" :
                  "assigned"
                }
                assigneeDropdownProgress={
                  globalFrame < 230 ? 0 :
                  globalFrame < 235 ? (globalFrame - 230) / 5 :
                  globalFrame < 256 ? 1 :
                  globalFrame < 261 ? 1 - (globalFrame - 256) / 5 :
                  0
                }
                typedText={
                  globalFrame < 240 ? "" :
                  globalFrame < 242 ? "B" :
                  globalFrame < 244 ? "Bu" :
                  globalFrame < 246 ? "Bui" :
                  globalFrame < 248 ? "Buil" :
                  globalFrame < 256 ? "Buil" :
                  ""
                }
              />
            </div>
          </div>
        )}

        {/* Slack thread panel (frames 272-300) */}
        {globalFrame >= 272 && globalFrame < 300 && (
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: 650,
              height: 1080,
              overflow: "hidden",
              boxShadow: "4px 0 20px rgba(0, 0, 0, 0.3)",
            }}
          >
            <SlackThreadPanel width={650} height={1080} />
          </div>
        )}

        {/* GitHub placeholder (from frame 300 onwards) */}
        {globalFrame >= 300 && (
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: 650,
              height: 1080,
              backgroundColor: "#2d333b",
              boxShadow: "4px 0 20px rgba(0, 0, 0, 0.3)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 40,
              fontFamily: "'Inter', sans-serif",
            }}
          >
            <div
              style={{
                fontSize: 48,
                fontWeight: 600,
                color: "#ffffff",
              }}
            >
              github
            </div>
            <button
              style={{
                padding: "12px 24px",
                fontSize: 18,
                fontWeight: 600,
                color: "#ffffff",
                backgroundColor: "#238636",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              View in Builder
            </button>
          </div>
        )}

        {/* Building phrase text animations */}
        <div
          style={{
            position: "absolute",
            left: 710,
            top: 340,
            display: "flex",
            flexDirection: "column",
            gap: 5,
            fontFamily: "'Inter', sans-serif",
            lineHeight: 1.0,
          }}
        >
          {/* "Works" - track-based animation */}
          {worksTextOpacity > 0 && (
            <div
              style={{
                fontSize: 100,
                fontWeight: 700,
                color: "#ffffff",
                transform: `translateY(${worksTextY}px)`,
                opacity: worksTextOpacity,
              }}
            >
              Works
            </div>
          )}

          {/* "where you" - track-based animation */}
          {whereYouTextOpacity > 0 && (
            <div
              style={{
                fontSize: 100,
                fontWeight: 700,
                color: "#ffffff",
                transform: `translateY(${whereYouTextY}px)`,
                opacity: whereYouTextOpacity,
              }}
            >
              where you
            </div>
          )}

          {/* "work" - track-based animation */}
          {workTextOpacity > 0 && (
            <div
              style={{
                fontSize: 100,
                fontWeight: 700,
                color: "#ffffff",
                transform: `translateY(${workTextY}px)`,
                opacity: workTextOpacity,
              }}
            >
              work
            </div>
          )}
        </div>
      </div>

      {/* Black overlay for fade to black at end of scene */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          backgroundColor: "#000000",
          opacity: sceneFadeOut,
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
};

/**
 * SCENE 3: Full team collaboration
 * Shows "Full team collaboration" typing out
 */
const Scene3TeamCollaboration: React.FC<{ accentColor: string; backgroundColor: string; tracks: AnimationTrack[] }> = ({
  accentColor,
  backgroundColor,
  tracks
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Scene 3 starts at global frame 336 (after Scene 1's 113 frames + Scene 2's 222 frames)
  const globalFrame = frame + 336;

  // Find typing track
  const typingTrack = findTrack(tracks, "team-collab-typing", FALLBACK_TRACKS[9]);
  const typingProgress = trackProgress(globalFrame, fps, typingTrack);
  const typingP = getPropValue(typingProgress, typingTrack, "progress", 0, 1);

  // Typing animation for "Full team collaboration"
  const typingText = "Full team collaboration";
  const typingDuration = typingTrack.endFrame - typingTrack.startFrame;
  const charsToShow = Math.floor(typingP * typingText.length);
  const visibleText = typingText.slice(0, charsToShow);

  // Second avatar animation
  const secondAvatarTrack = findTrack(tracks, "second-avatar", FALLBACK_TRACKS[10]);
  const secondAvatarProgress = trackProgress(globalFrame, fps, secondAvatarTrack);
  const secondAvatarX = getPropValue(secondAvatarProgress, secondAvatarTrack, "x", -75, 0);
  const secondAvatarOpacity = getPropValue(secondAvatarProgress, secondAvatarTrack, "opacity", 0, 1);

  // Third avatar animation
  const thirdAvatarTrack = findTrack(tracks, "third-avatar", FALLBACK_TRACKS[11]);
  const thirdAvatarProgress = trackProgress(globalFrame, fps, thirdAvatarTrack);
  const thirdAvatarX = getPropValue(thirdAvatarProgress, thirdAvatarTrack, "x", -75, 0);
  const thirdAvatarOpacity = getPropValue(thirdAvatarProgress, thirdAvatarTrack, "opacity", 0, 1);

  // Fourth avatar animation
  const fourthAvatarTrack = findTrack(tracks, "fourth-avatar", FALLBACK_TRACKS[12]);
  const fourthAvatarProgress = trackProgress(globalFrame, fps, fourthAvatarTrack);
  const fourthAvatarX = getPropValue(fourthAvatarProgress, fourthAvatarTrack, "x", -75, 0);
  const fourthAvatarOpacity = getPropValue(fourthAvatarProgress, fourthAvatarTrack, "opacity", 0, 1);

  // Show team collaboration content until frame 395, then cut to Builder view
  const showTeamCollab = globalFrame < 395;

  return (
    <AbsoluteFill style={{ backgroundColor }}>
      {showTeamCollab ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            fontFamily: "'Inter', sans-serif",
            gap: 60,
          }}
        >
        {/* Current users avatar with + button */}
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            gap: 0,
            transform: `translateX(${-35 * (secondAvatarOpacity + thirdAvatarOpacity + fourthAvatarOpacity)}px)`,
          }}
        >
          {/* First portrait */}
          <div
            style={{
              width: 100,
              height: 100,
              borderRadius: "50%",
              overflow: "hidden",
              position: "relative",
              zIndex: 4,
            }}
          >
            <img
              src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F6eada205a8dc4ebd918806181f6264fc?format=webp&width=800&height=1200"
              alt="User 1"
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
              }}
            />
          </div>

          {/* Second portrait (springs in during typing, behind first) */}
          {secondAvatarOpacity > 0 && (
            <div
              style={{
                width: 100,
                height: 100,
                borderRadius: "50%",
                overflow: "hidden",
                position: "absolute",
                left: 70,
                zIndex: 3,
                transform: `translateX(${secondAvatarX}px)`,
                opacity: secondAvatarOpacity,
              }}
            >
              <img
                src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fec2ef10d3c7343589e377f53c2d1f134?format=webp&width=800&height=1200"
                alt="User 2"
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                }}
              />
            </div>
          )}

          {/* Third portrait */}
          {thirdAvatarOpacity > 0 && (
            <div
              style={{
                width: 100,
                height: 100,
                borderRadius: "50%",
                overflow: "hidden",
                position: "absolute",
                left: 140,
                zIndex: 2,
                transform: `translateX(${thirdAvatarX}px)`,
                opacity: thirdAvatarOpacity,
              }}
            >
              <img
                src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Ffe6b38cf28954de4a12d1f45866b7f61?format=webp&width=800&height=1200"
                alt="User 3"
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                }}
              />
            </div>
          )}

          {/* Fourth portrait */}
          {fourthAvatarOpacity > 0 && (
            <div
              style={{
                width: 100,
                height: 100,
                borderRadius: "50%",
                overflow: "hidden",
                position: "absolute",
                left: 210,
                zIndex: 1,
                transform: `translateX(${fourthAvatarX}px)`,
                opacity: fourthAvatarOpacity,
              }}
            >
              <img
                src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F5d0eec6c1506451d833346be322ff504?format=webp&width=800&height=1200"
                alt="User 4"
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                }}
              />
            </div>
          )}

          {/* + button circle (behind portraits) */}
          <div
            style={{
              width: 100,
              height: 100,
              borderRadius: "50%",
              backgroundColor: "rgba(255, 255, 255, 0.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 40,
              fontWeight: 600,
              color: "#ffffff",
              position: "absolute",
              left: fourthAvatarOpacity > 0
                ? 280 + fourthAvatarX
                : thirdAvatarOpacity > 0
                  ? 210 + thirdAvatarX
                  : secondAvatarOpacity > 0
                    ? 140 + secondAvatarX
                    : 70,
              zIndex: 0,
            }}
          >
            +
          </div>
        </div>

        {/* Main title "Full team collaboration" */}
        <div
          style={{
            fontSize: 80,
            color: "#ffffff",
            fontWeight: 700,
            letterSpacing: "-0.02em",
          }}
        >
          {visibleText}
          {/* Blinking cursor during typing */}
          {typingP > 0 && typingP < 1 && (
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
      ) : (
        <StandardView
          width={1920}
          height={1080}
          tracks={tracks}
          branchName="main"
          projectName="videos"
          url="localhost:3000"
        />
      )}
    </AbsoluteFill>
  );
};
