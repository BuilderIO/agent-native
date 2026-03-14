import { AbsoluteFill } from "remotion";
import { createInteractiveComposition } from "@/remotion/hooks/createInteractiveComposition";
import { InteractiveButton } from "@/remotion/ui-components/InteractiveButton";
import { InteractiveCard } from "@/remotion/ui-components/InteractiveCard";
import type { AnimationTrack } from "@/types";

export type BlankCompositionProps = {
  showExamples?: boolean;
};

const FALLBACK_TRACKS: AnimationTrack[] = [
  {
    id: "camera",
    label: "Camera",
    startFrame: 0,
    endFrame: 240,
    easing: "linear",
    animatedProps: [
      { property: "translateX", from: "0", to: "0", unit: "px", keyframes: [] },
      { property: "translateY", from: "0", to: "0", unit: "px", keyframes: [] },
      { property: "scale", from: "1", to: "1", unit: "", keyframes: [] },
      { property: "rotateX", from: "0", to: "0", unit: "deg", keyframes: [] },
      { property: "rotateY", from: "0", to: "0", unit: "deg", keyframes: [] },
      {
        property: "perspective",
        from: "800",
        to: "800",
        unit: "px",
        keyframes: [],
      },
    ],
  },
  {
    id: "cursor",
    label: "Cursor",
    startFrame: 0,
    endFrame: 240,
    easing: "expo.inOut",
    animatedProps: [
      { property: "x", from: "960", to: "960", unit: "px", keyframes: [] },
      { property: "y", from: "540", to: "540", unit: "px", keyframes: [] },
      { property: "opacity", from: "1", to: "1", unit: "", keyframes: [] },
      { property: "scale", from: "1", to: "1", unit: "", keyframes: [] },
      { property: "type", from: "default", to: "default", unit: "" },
      { property: "isClicking", from: "0", to: "0", unit: "" },
    ],
  },
];

/**
 * BlankComposition - Starting template for new compositions
 *
 * DEMONSTRATES BEST PRACTICES:
 * ✓ Uses createInteractiveComposition for automatic setup
 * ✓ Includes example interactive components (button & card)
 * ✓ Shows proper zone positioning and sizing
 * ✓ Registers all components with cursor system
 * ✓ Ready for camera movements and cursor interactions
 *
 * TO GET STARTED:
 * 1. Hover over the example components to see them in Cursor Interactions panel
 * 2. Add hover animations (scale, lift, glow, etc.)
 * 3. Add click animations for interactive feedback
 * 4. Replace/remove examples and add your own interactive elements
 * 5. Use camera controls to pan, zoom, and tilt
 *
 * CREATING YOUR OWN INTERACTIVE COMPONENTS:
 * - Import InteractiveButton or InteractiveCard from @/remotion/ui-components
 * - Or create custom components using useInteractiveComponent hook
 * - Always define precise zones for accurate hover detection
 * - Always register components with registerForCursor
 * - Always use safe fallbacks (?.value ?? 0) for animation values
 */
export const BlankComposition =
  createInteractiveComposition<BlankCompositionProps>({
    fallbackTracks: FALLBACK_TRACKS,
    render: (context, props) => {
      const { showExamples = true } = props;

      return (
        <AbsoluteFill style={{ backgroundColor: "#0a0a0a" }}>
          {/* Main content area */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "100%",
              height: "100%",
              flexDirection: "column",
              gap: 40,
            }}
          >
            {/* Placeholder message */}
            <p
              style={{
                color: "rgba(255, 255, 255, 0.3)",
                fontSize: 32,
                fontFamily: "'Inter', sans-serif",
                textAlign: "center",
                maxWidth: "80%",
              }}
            >
              Add to the video by asking the agent to create something
            </p>

            {showExamples && (
              <>
                <p
                  style={{
                    color: "rgba(255, 255, 255, 0.2)",
                    fontSize: 16,
                    fontFamily: "'Inter', sans-serif",
                    textAlign: "center",
                    maxWidth: "60%",
                  }}
                >
                  Hover over the examples below to see them in the Cursor
                  Interactions panel →
                </p>

                {/* Example Interactive Button */}
                <InteractiveButton
                  id="example-button"
                  compositionId="blank"
                  label="Click Me!"
                  x={810}
                  y={450}
                  width={300}
                  height={60}
                  backgroundColor="#6366f1"
                  textColor="#ffffff"
                  cursorHistory={context.cursorHistory}
                  tracks={context.tracks}
                  registerForCursor={context.registerForCursor}
                />

                {/* Example Interactive Cards */}
                <div
                  style={{
                    position: "absolute",
                    top: 600,
                    left: 460,
                    display: "flex",
                    gap: 40,
                  }}
                >
                  <InteractiveCard
                    id="example-card-1"
                    compositionId="blank"
                    title="Interactive Card"
                    description="Hover to select and add animations"
                    icon="🎨"
                    x={0}
                    y={0}
                    width={300}
                    height={200}
                    accentColor="#6366f1"
                    cursorHistory={context.cursorHistory}
                    tracks={context.tracks}
                    registerForCursor={context.registerForCursor}
                  />

                  <InteractiveCard
                    id="example-card-2"
                    compositionId="blank"
                    title="Another Card"
                    description="Add scale, lift, glow effects"
                    icon="✨"
                    x={340}
                    y={0}
                    width={300}
                    height={200}
                    accentColor="#a855f7"
                    cursorHistory={context.cursorHistory}
                    tracks={context.tracks}
                    registerForCursor={context.registerForCursor}
                  />

                  <InteractiveCard
                    id="example-card-3"
                    compositionId="blank"
                    title="One More"
                    description="Each has unique animations"
                    icon="🚀"
                    x={680}
                    y={0}
                    width={300}
                    height={200}
                    accentColor="#ec4899"
                    cursorHistory={context.cursorHistory}
                    tracks={context.tracks}
                    registerForCursor={context.registerForCursor}
                  />
                </div>
              </>
            )}
          </div>
        </AbsoluteFill>
      );
    },
  });
