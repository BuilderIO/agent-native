import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from "remotion";
import type { AnimationTrack } from "@/types";
import { findTrack, trackProgress } from "../trackAnimation";
import { createInteractiveComposition } from "../hooks/createInteractiveComposition";
import {
  useInteractiveComponent,
  AnimationPresets,
} from "../hooks/useInteractiveComponent";
import { UIHeader } from "../ui-components/UIHeader";
import { UISidebar } from "../ui-components/UISidebar";
import { UIVideoPlayer } from "../ui-components/UIVideoPlayer";
import { UICameraToolbar } from "../ui-components/UICameraToolbar";
import { UITimeline } from "../ui-components/UITimeline";

export type UIShowcaseProps = {
  tracks?: AnimationTrack[];
};

const FALLBACK_TRACKS: AnimationTrack[] = [
  {
    id: "ui-entrance",
    label: "UI Entrance",
    startFrame: 0,
    endFrame: 44,
    easing: "power2.out",
    animatedProps: [{ property: "opacity", from: "0", to: "1", unit: "" }],
  },
  {
    id: "cursor",
    label: "Cursor",
    startFrame: 0,
    endFrame: 450,
    easing: "linear",
    animatedProps: [
      { property: "x", from: "200", to: "960", unit: "px" },
      { property: "y", from: "100", to: "540", unit: "px" },
      { property: "type", from: "default", to: "default", unit: "" },
    ],
  },
  {
    id: "switch-to-properties",
    label: "Switch to Properties",
    startFrame: 60,
    endFrame: 60,
    easing: "linear",
    animatedProps: [
      { property: "tab state", from: "", to: "", unit: "", programmatic: true },
    ],
  },
  {
    id: "camera-panel-open",
    label: "Camera Panel Open",
    startFrame: 180,
    endFrame: 240,
    easing: "spring",
    animatedProps: [{ property: "panelOpen", from: "0", to: "1", unit: "" }],
  },
  {
    id: "pan-tool-active",
    label: "Pan Tool Active",
    startFrame: 240,
    endFrame: 300,
    easing: "linear",
    animatedProps: [{ property: "toolActive", from: "0", to: "1", unit: "" }],
  },
  {
    id: "timeline-playback",
    label: "Timeline Playback",
    startFrame: 0,
    endFrame: 450,
    easing: "linear",
    animatedProps: [{ property: "progress", from: "0", to: "0.67", unit: "" }],
  },
];

export const UIShowcase = createInteractiveComposition<UIShowcaseProps>({
  fallbackTracks: FALLBACK_TRACKS,

  render: ({ cursorHistory, tracks, registerForCursor }, props) => {
    const frame = useCurrentFrame();
    const { fps, width, height } = useVideoConfig();

    // Find tracks
    const entranceTrack = findTrack(tracks, "ui-entrance", FALLBACK_TRACKS[0]);
    const tabSwitchTrack = findTrack(
      tracks,
      "switch-to-properties",
      FALLBACK_TRACKS[2],
    );
    const cameraPanelTrack = findTrack(
      tracks,
      "camera-panel-open",
      FALLBACK_TRACKS[3],
    );
    const panToolTrack = findTrack(
      tracks,
      "pan-tool-active",
      FALLBACK_TRACKS[4],
    );
    const timelinePlaybackTrack = findTrack(
      tracks,
      "timeline-playback",
      FALLBACK_TRACKS[5],
    );

    // Entrance animation
    const entranceP = trackProgress(frame, fps, entranceTrack);
    const entranceOpacity = interpolate(entranceP, [0, 1], [0, 1]);

    // Tab switch - keyframe style (frame >= startFrame means tab is switched)
    const activeTab =
      frame >= tabSwitchTrack.startFrame ? "properties" : "compositions";

    // Camera panel open - read progress from track
    const cameraPanelP = trackProgress(frame, fps, cameraPanelTrack);
    const cameraPanelOpen = cameraPanelP > 0;

    // Pan tool active - read from track (active when within track range)
    const panToolP = trackProgress(frame, fps, panToolTrack);
    const activeTool = panToolP > 0 && panToolP < 1 ? "pan" : null;

    // Timeline playback - read progress from track
    const playheadP = trackProgress(frame, fps, timelinePlaybackTrack);
    const playheadProgress = interpolate(playheadP, [0, 1], [0, 0.67], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

    // Scale and padding constants for zones
    const SCALE = 1.3;
    const UI_WIDTH = 1280;
    const UI_HEIGHT = 760;

    // Calculate offset for centered UI
    const uiOffsetX = (width - UI_WIDTH * SCALE) / 2;
    const uiOffsetY = (height - UI_HEIGHT * SCALE) / 2;

    // Helper to convert UI coordinates to composition coordinates
    const toCompZone = (x: number, y: number, w: number, h: number) => ({
      x: uiOffsetX + x * SCALE,
      y: uiOffsetY + y * SCALE,
      width: w * SCALE,
      height: h * SCALE,
    });

    // Interactive elements (using new UI dimensions)
    const newCompButton = useInteractiveComponent({
      id: "new-comp",
      elementType: "Button",
      label: "New Composition",
      compositionId: "ui-showcase",
      zone: toCompZone(16, 100, 288, 36),
      cursorHistory,
      interactiveElementType: "button",
      hoverAnimation: AnimationPresets.scaleHover(0.1),
    });

    const compositionsTab = useInteractiveComponent({
      id: "compositions-tab",
      elementType: "Tab",
      label: "Compositions Tab",
      compositionId: "ui-showcase",
      zone: toCompZone(0, 48, 160, 40),
      cursorHistory,
      interactiveElementType: "button",
      hoverAnimation: AnimationPresets.scaleHover(0.05),
    });

    const propertiesTab = useInteractiveComponent({
      id: "properties-tab",
      elementType: "Tab",
      label: "Properties Tab",
      compositionId: "ui-showcase",
      zone: toCompZone(160, 48, 160, 40),
      cursorHistory,
      interactiveElementType: "button",
      hoverAnimation: AnimationPresets.scaleHover(0.05),
    });

    const panTool = useInteractiveComponent({
      id: "pan-tool",
      elementType: "Button",
      label: "Pan Tool",
      compositionId: "ui-showcase",
      zone: toCompZone(206, 80, 70, 32),
      cursorHistory,
      interactiveElementType: "button",
      hoverAnimation: AnimationPresets.scaleHover(0.08),
    });

    const addKeyframeBtn = useInteractiveComponent({
      id: "add-keyframe",
      elementType: "Button",
      label: "Add Keyframe",
      compositionId: "ui-showcase",
      zone: toCompZone(448, 80, 120, 32),
      cursorHistory,
      interactiveElementType: "button",
      hoverAnimation: AnimationPresets.scaleHover(0.08),
    });

    const playButton = useInteractiveComponent({
      id: "play-button",
      elementType: "Button",
      label: "Play Button",
      compositionId: "ui-showcase",
      zone: toCompZone(365, 450, 24, 24),
      cursorHistory,
      interactiveElementType: "button",
      hoverAnimation: AnimationPresets.scaleHover(0.1),
    });

    const timelineKeyframe = useInteractiveComponent({
      id: "timeline-kf",
      elementType: "Keyframe",
      label: "Timeline Keyframe",
      compositionId: "ui-showcase",
      zone: toCompZone(580, 510, 24, 24),
      cursorHistory,
      interactiveElementType: "button",
      hoverAnimation: AnimationPresets.scaleHover(0.15),
    });

    const cameraAccordion = useInteractiveComponent({
      id: "camera-accordion",
      elementType: "Accordion",
      label: "Camera Accordion",
      compositionId: "ui-showcase",
      zone: toCompZone(10, 98, 300, 40),
      cursorHistory,
      interactiveElementType: "button",
      hoverAnimation: AnimationPresets.scaleHover(0.05),
    });

    const cursorAccordion = useInteractiveComponent({
      id: "cursor-accordion",
      elementType: "Accordion",
      label: "Cursor Accordion",
      compositionId: "ui-showcase",
      zone: toCompZone(10, 150, 300, 40),
      cursorHistory,
      interactiveElementType: "button",
      hoverAnimation: AnimationPresets.scaleHover(0.05),
    });

    const animationTrackAccordion = useInteractiveComponent({
      id: "animation-track-accordion",
      elementType: "Accordion",
      label: "Animation Track Accordion",
      compositionId: "ui-showcase",
      zone: toCompZone(10, 202, 300, 40),
      cursorHistory,
      interactiveElementType: "button",
      hoverAnimation: AnimationPresets.scaleHover(0.05),
    });

    // Register all for cursor aggregation
    registerForCursor(compositionsTab);
    registerForCursor(newCompButton);
    registerForCursor(propertiesTab);
    registerForCursor(panTool);
    registerForCursor(addKeyframeBtn);
    registerForCursor(playButton);
    registerForCursor(timelineKeyframe);
    registerForCursor(cameraAccordion);
    registerForCursor(cursorAccordion);
    registerForCursor(animationTrackAccordion);

    return (
      <AbsoluteFill
        style={{
          background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)",
          opacity: entranceOpacity,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Scaled UI Container with border */}
        <div
          style={{
            position: "relative",
            width: UI_WIDTH,
            height: UI_HEIGHT,
            transform: `scale(${SCALE})`,
            transformOrigin: "center center",
            borderRadius: "16px",
            overflow: "hidden",
            boxShadow:
              "0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.1)",
          }}
        >
          {/* Header */}
          <UIHeader x={0} y={0} width={UI_WIDTH} height={48} />

          {/* Sidebar */}
          <UISidebar
            x={0}
            y={48}
            width={320}
            height={UI_HEIGHT - 48}
            activeTab={activeTab}
            cameraPanelOpen={cameraPanelOpen}
            cameraPanelProgress={cameraPanelP}
            compositionsTab={compositionsTab}
            propertiesTab={propertiesTab}
            newCompButton={newCompButton}
            cameraAccordion={cameraAccordion}
            cursorAccordion={cursorAccordion}
            animationTrackAccordion={animationTrackAccordion}
          />

          {/* Main content area */}
          <div
            style={{
              position: "absolute",
              left: 320,
              top: 48,
              width: UI_WIDTH - 320,
              height: UI_HEIGHT - 48,
            }}
          >
            {/* Camera Toolbar */}
            <UICameraToolbar
              x={(UI_WIDTH - 320) / 2 - 320}
              y={20}
              activeTool={activeTool}
            />

            {/* Video Player */}
            <UIVideoPlayer
              x={(UI_WIDTH - 320) / 2 - 320}
              y={72}
              width={640}
              height={360}
              playheadProgress={playheadProgress}
            />

            {/* Timeline */}
            <UITimeline
              x={0}
              y={UI_HEIGHT - 320}
              width={UI_WIDTH - 320}
              height={280}
              playheadProgress={playheadProgress}
            />
          </div>
        </div>
      </AbsoluteFill>
    );
  },
});
