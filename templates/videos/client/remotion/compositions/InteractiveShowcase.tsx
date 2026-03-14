import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";
import { createInteractiveComposition } from "@/remotion/hooks/createInteractiveComposition";
import { useInteractiveComponent } from "@/remotion/hooks/useInteractiveComponent";
import type { CursorFrame } from "@/remotion/hooks/useCursorHistory";
import type { AnimationTrack } from "@/types";

export type InteractiveShowcaseProps = {
  title?: string;
  subtitle?: string;
};

const FALLBACK_TRACKS = [
  {
    id: "camera",
    label: "Camera",
    startFrame: 0,
    endFrame: 300,
    easing: "linear" as const,
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
    endFrame: 300,
    easing: "expo.inOut" as const,
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
 * Interactive Showcase - Demonstrates the full power of Video Studio:
 * - Cursor interactions with hover/click animations
 * - Camera movements (pan, zoom, tilt)
 * - Spring physics and smooth animations
 * - Interactive cards and buttons
 * - Programmatic effects
 */
export const InteractiveShowcase = createInteractiveComposition<InteractiveShowcaseProps>({
  fallbackTracks: FALLBACK_TRACKS,
  render: (context, props) => {
    const { title = "Video Studio", subtitle = "Interactive Showcase" } = props;
    const frame = useCurrentFrame();
    const { fps, width, height } = useVideoConfig();

    // Title animation - fade in with spring
    const titleProgress = spring({
      frame,
      fps,
      config: { damping: 15, stiffness: 80 },
    });

    const titleOpacity = interpolate(titleProgress, [0, 1], [0, 1]);
    const titleY = interpolate(titleProgress, [0, 1], [-50, 0]);

    // Subtitle animation - delayed spring
    const subtitleProgress = spring({
      frame: frame - 15,
      fps,
      config: { damping: 20, stiffness: 100 },
    });

    const subtitleOpacity = interpolate(subtitleProgress, [0, 1], [0, 0.8]);
    const subtitleY = interpolate(subtitleProgress, [0, 1], [30, 0]);

    // Feature cards animation - staggered entrance
    const cardsDelay = 30;
    const cardStagger = 8;

    // Card grid layout calculations
    const gridMaxWidth = 1400;
    const gridPadding = 40;
    const gridGap = 40;
    const cardWidth = (gridMaxWidth - gridPadding * 2 - gridGap * 2) / 3;
    const cardHeight = 280;

    // Grid starts at center, offset by half maxWidth
    const gridStartX = (width - gridMaxWidth) / 2 + gridPadding;
    const gridStartY = height / 2 - 50; // Centered vertically with slight offset

    return (
      <AbsoluteFill style={{ backgroundColor: "#0a0a0f" }}>
        {/* Animated gradient background */}
        <AbsoluteFill
          style={{
            background: `radial-gradient(circle at ${50 + Math.sin(frame * 0.02) * 20}% ${50 + Math.cos(frame * 0.03) * 20}%, rgba(99, 102, 241, 0.15) 0%, transparent 60%)`,
            opacity: 0.6,
          }}
        />

        {/* Title section */}
        <AbsoluteFill
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "flex-start",
            paddingTop: 100,
          }}
        >
          <div
            style={{
              fontSize: 96,
              fontWeight: 900,
              background: "linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #ec4899 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              opacity: titleOpacity,
              transform: `translateY(${titleY}px)`,
            }}
          >
            {title}
          </div>
          <div
            style={{
              fontSize: 28,
              color: "#94a3b8",
              marginTop: 10,
              opacity: subtitleOpacity,
              transform: `translateY(${subtitleY}px)`,
            }}
          >
            {subtitle}
          </div>
        </AbsoluteFill>

        {/* Feature cards grid */}
        <AbsoluteFill
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            paddingTop: 100,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 40,
              maxWidth: 1400,
              padding: 40,
            }}
          >
            {/* Card 1: Camera Controls */}
            <FeatureCard
              id="camera-card"
              title="Camera Controls"
              description="Pan, zoom, and tilt in 3D space"
              icon="🎥"
              color="#3b82f6"
              delay={cardsDelay}
              frame={frame}
              fps={fps}
              zone={{ x: gridStartX, y: gridStartY, width: cardWidth, height: cardHeight }}
              cursorHistory={context.cursorHistory}
              tracks={context.tracks}
              registerForCursor={context.registerForCursor}
            />

            {/* Card 2: Cursor Interactions */}
            <FeatureCard
              id="cursor-card"
              title="Cursor Magic"
              description="Hover and click animations"
              icon="✨"
              color="#a855f7"
              delay={cardsDelay + cardStagger}
              frame={frame}
              fps={fps}
              zone={{ x: gridStartX + cardWidth + gridGap, y: gridStartY, width: cardWidth, height: cardHeight }}
              cursorHistory={context.cursorHistory}
              tracks={context.tracks}
              registerForCursor={context.registerForCursor}
            />

            {/* Card 3: Spring Physics */}
            <FeatureCard
              id="spring-card"
              title="Spring Physics"
              description="Natural, bouncy animations"
              icon="🎪"
              color="#ec4899"
              delay={cardsDelay + cardStagger * 2}
              frame={frame}
              fps={fps}
              zone={{ x: gridStartX + (cardWidth + gridGap) * 2, y: gridStartY, width: cardWidth, height: cardHeight }}
              cursorHistory={context.cursorHistory}
              tracks={context.tracks}
              registerForCursor={context.registerForCursor}
            />

            {/* Card 4: Programmatic FX */}
            <FeatureCard
              id="code-card"
              title="Code-Driven"
              description="Programmatic effects with parameters"
              icon="⚡"
              color="#f59e0b"
              delay={cardsDelay + cardStagger * 3}
              frame={frame}
              fps={fps}
              zone={{ x: gridStartX, y: gridStartY + cardHeight + gridGap, width: cardWidth, height: cardHeight }}
              cursorHistory={context.cursorHistory}
              tracks={context.tracks}
              registerForCursor={context.registerForCursor}
            />

            {/* Card 5: Timeline Editor */}
            <FeatureCard
              id="timeline-card"
              title="Visual Timeline"
              description="Drag keyframes, adjust easing"
              icon="🎬"
              color="#10b981"
              delay={cardsDelay + cardStagger * 4}
              frame={frame}
              fps={fps}
              zone={{ x: gridStartX + cardWidth + gridGap, y: gridStartY + cardHeight + gridGap, width: cardWidth, height: cardHeight }}
              cursorHistory={context.cursorHistory}
              tracks={context.tracks}
              registerForCursor={context.registerForCursor}
            />

            {/* Card 6: Export Ready */}
            <FeatureCard
              id="export-card"
              title="Export to Video"
              description="Render to MP4, WebM, or GIF"
              icon="🚀"
              color="#06b6d4"
              delay={cardsDelay + cardStagger * 5}
              frame={frame}
              fps={fps}
              zone={{ x: gridStartX + (cardWidth + gridGap) * 2, y: gridStartY + cardHeight + gridGap, width: cardWidth, height: cardHeight }}
              cursorHistory={context.cursorHistory}
              tracks={context.tracks}
              registerForCursor={context.registerForCursor}
            />
          </div>
        </AbsoluteFill>

        {/* Floating particles in background */}
        {Array.from({ length: 20 }).map((_, i) => {
          const particleFrame = frame + i * 10;
          const x = interpolate(
            particleFrame,
            [0, 300],
            [Math.sin(i * 2) * width, Math.sin(i * 2 + 3) * width],
            { extrapolateRight: "wrap" }
          );
          const y = interpolate(
            particleFrame,
            [0, 300],
            [Math.cos(i * 3) * height, Math.cos(i * 3 + 2) * height],
            { extrapolateRight: "wrap" }
          );
          const size = 4 + (i % 3) * 2;

          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: width / 2 + x / 2,
                top: height / 2 + y / 2,
                width: size,
                height: size,
                borderRadius: "50%",
                backgroundColor: `hsl(${(i * 30) % 360}, 70%, 60%)`,
                opacity: 0.3,
                filter: "blur(1px)",
              }}
            />
          );
        })}

        {/* Bottom text */}
        <AbsoluteFill
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            paddingBottom: 60,
          }}
        >
          <div
            style={{
              fontSize: 18,
              color: "#64748b",
              opacity: interpolate(frame, [60, 90], [0, 0.6], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
            }}
          >
            Powered by React + Remotion
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
    );
  },
});

/**
 * Feature card component with spring entrance animation and interactive hover
 */
function FeatureCard({
  id,
  title,
  description,
  icon,
  color,
  delay,
  frame,
  fps,
  zone,
  cursorHistory,
  tracks,
  registerForCursor,
}: {
  id: string;
  title: string;
  description: string;
  icon: string;
  color: string;
  delay: number;
  frame: number;
  fps: number;
  zone: { x: number; y: number; width: number; height: number };
  cursorHistory: CursorFrame[];
  tracks: AnimationTrack[];
  registerForCursor: (component: any) => void;
}) {
  // Register as interactive component
  const interactive = useInteractiveComponent({
    compositionId: "interactive-showcase",
    id,
    elementType: "Card",
    label: title,
    zone,
    cursorHistory,
    tracks,
    interactiveElementType: "button",
  });

  // Register with cursor system
  React.useEffect(() => {
    registerForCursor(interactive);
  }, [interactive.hover.isHovering, interactive.click.isClicking]);

  const progress = spring({
    frame: frame - delay,
    fps,
    config: { damping: 18, stiffness: 90 },
  });

  const scale = interpolate(progress, [0, 1], [0.8, 1]);
  const opacity = interpolate(progress, [0, 1], [0, 1]);
  const y = interpolate(progress, [0, 1], [30, 0]);

  // Extract animation values from animatedProperties (already combines hover + click)
  // The hook automatically combines hover and click animations for us!
  // Values are absolute (e.g., scale: 1.0 at rest, 1.4 when clicking)
  // Extract all animation properties with safe defaults
  const animScale = (interactive.animatedProperties?.scale as number) ?? 1;
  const animTranslateX = (interactive.animatedProperties?.translateX as number) ?? 0;
  const animTranslateY = (interactive.animatedProperties?.translateY as number) ?? 0;
  const animLift = (interactive.animatedProperties?.lift as number) ?? 0;  // Alias for moving UP
  const animRotate = (interactive.animatedProperties?.rotate as number) ??
                     (interactive.animatedProperties?.rotateZ as number) ?? 0;
  const animGlow = (interactive.animatedProperties?.glow as number) ?? 0;
  const animBlur = (interactive.animatedProperties?.blur as number) ?? 0;
  const animColor = (interactive.animatedProperties?.color as number) ?? 0;
  const animBrightness = (interactive.animatedProperties?.brightness as number) ?? 1;
  const animOpacity = (interactive.animatedProperties?.opacity as number) ?? 1;
  const animBgColor = interactive.animatedProperties?.backgroundColor as string | undefined;

  // Determine if we should use animated backgroundColor
  // Only apply animated backgroundColor when actually hovering or clicking
  const isInteracting = interactive.hover.isHovering || interactive.click.isClicking;
  const backgroundColor = isInteracting && animBgColor ? animBgColor : "rgba(17, 24, 39, 0.7)";

  return (
    <div
      style={{
        backgroundColor,
        borderRadius: 20,
        padding: 30,
        border: `2px solid ${color}40`,
        backdropFilter: "blur(10px)",
        // Apply animations (hover + click already combined by hook)
        // Entrance 'y' + interactive transforms + lift (UP)
        transform: `
          translateX(${animTranslateX}px)
          translateY(${y + animTranslateY - animLift}px)
          scale(${scale * animScale})
          rotate(${animRotate}deg)
        `,
        opacity: opacity * animOpacity,
        boxShadow: `0 ${10 + (animLift + Math.abs(animTranslateY)) / 2}px ${40 + animGlow}px ${color}${Math.round(30 + animGlow / 2).toString(16)}, 0 0 ${animGlow}px ${color}${Math.round(20 + animGlow / 3).toString(16)}`,
        filter: `blur(${animBlur}px)${animColor !== 0 ? ` hue-rotate(${animColor}deg)` : ''}${animBrightness !== 1 ? ` brightness(${animBrightness})` : ''}`,
        transition: "all 0.3s ease",
      }}
    >
      {/* Icon */}
      <div
        style={{
          fontSize: 48,
          marginBottom: 20,
          filter: `drop-shadow(0 0 20px ${color}80)`,
        }}
      >
        {icon}
      </div>

      {/* Title */}
      <div
        style={{
          fontSize: 24,
          fontWeight: 700,
          color: "#f1f5f9",
          marginBottom: 10,
        }}
      >
        {title}
      </div>

      {/* Description */}
      <div
        style={{
          fontSize: 14,
          color: "#94a3b8",
          lineHeight: 1.6,
        }}
      >
        {description}
      </div>

      {/* Accent line */}
      <div
        style={{
          marginTop: 20,
          height: 3,
          background: `linear-gradient(90deg, ${color} 0%, transparent 100%)`,
          borderRadius: 2,
        }}
      />
    </div>
  );
}
