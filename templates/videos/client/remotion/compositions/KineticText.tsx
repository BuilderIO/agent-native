import React, { useMemo } from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from "remotion";
import type { AnimationTrack } from "@/types";
import { trackProgress, getPropValue, findTrack } from "../trackAnimation";
import { CameraHost } from "../CameraHost";

export type KineticTextProps = {
  title: string;
  subtitle: string;
  backgroundColor: string;
  textColor: string;
  accentColor: string;
  tracks?: AnimationTrack[];
};

const FALLBACK_TRACKS: AnimationTrack[] = [
  {
    id: "kt-title", label: "Title Typing", startFrame: 0, endFrame: 50, easing: "linear",
    animatedProps: [
      {
        property: "typing reveal",
        from: "", to: "", unit: "",
        programmatic: true,
        description:
          "Letters appear one by one linearly while the text position drifts from right to left with quartic (power4) easing. Text starts offset to the right and smoothly drifts left to center as characters appear, creating an inertia effect.",
        codeSnippet:
`const charsToShow = Math.floor(titleP * title.length);
const visibleTitle = title.slice(0, charsToShow);

// Drift with quartic easing (power4.out)
const avgCharWidth = 0.6;
const pixelsPerChar = fontSize * avgCharWidth;
const totalWidth = title.length * pixelsPerChar;
const startOffset = totalWidth / 8; // Subtle offset
const easedProgress = 1 - Math.pow(1 - titleP, 4); // power4.out
const driftX = startOffset * (1 - easedProgress);

transform: \`translateX(\${driftX}px)\``,
      },
    ],
  },
  {
    id: "kt-explode", label: "Text Explode", startFrame: 86, endFrame: 120, easing: "power2.out",
    animatedProps: [
      {
        property: "explode scatter",
        from: "", to: "", unit: "",
        programmatic: true,
        description:
          "Each character explodes outward from its position. Characters scatter in seeded random directions with rotation and scale, then fade out. The explosion uses power2.out easing for a fast burst that decelerates.",
        parameters: [
          { name: "spread", label: "Spread Distance", default: 800, min: 100, max: 2000, step: 50 },
          { name: "rotationAmount", label: "Max Rotation", default: 720, min: 0, max: 1440, step: 45 },
          { name: "scaleEnd", label: "End Scale", default: 0, min: 0, max: 2, step: 0.1 },
        ],
        codeSnippet:
`// Each char gets a seeded random direction
const seed = (i * 7 + 13) % 100 / 100;
const angle = seed * Math.PI * 2;
const dist = spread * (0.5 + seed * 0.5) * progress;
const x = Math.cos(angle) * dist;
const y = Math.sin(angle) * dist;
const rot = (seed - 0.5) * rotationAmount * progress;
const s = 1 + (scaleEnd - 1) * progress;
const opacity = 1 - progress;`,
      },
    ],
  },
];

export const KineticText: React.FC<KineticTextProps> = ({
  title,
  subtitle,
  backgroundColor,
  textColor,
  accentColor,
  tracks = FALLBACK_TRACKS,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const titleTrack = findTrack(tracks, "kt-title", FALLBACK_TRACKS[0]);
  const titleP = trackProgress(frame, fps, titleTrack);

  const explodeTrack = findTrack(tracks, "kt-explode", FALLBACK_TRACKS[1]);
  const explodeP = trackProgress(frame, fps, explodeTrack);
  const isExploding = frame >= explodeTrack.startFrame;

  // Read common animated properties from track (always available for custom animations)
  const titleScale = getPropValue(titleP, titleTrack, "scale", 1, 1);
  const titleOpacity = getPropValue(titleP, titleTrack, "opacity", 1, 1);
  const titleTranslateX = getPropValue(titleP, titleTrack, "translateX", 0, 0);
  const titleTranslateY = getPropValue(titleP, titleTrack, "translateY", 0, 0);
  const titleRotation = getPropValue(titleP, titleTrack, "rotation", 0, 0);

  // Typing animation: reveal characters one by one (linear)
  const charsToShow = Math.max(0, Math.floor(titleP * title.length));
  const visibleTitle = title.slice(0, charsToShow);

  // Read parameters from the typing reveal property
  const typingProp = titleTrack?.animatedProps?.find(p => p.property === "typing reveal");
  const avgCharWidth = typingProp?.parameterValues?.avgCharWidth ?? 0.6;
  const offsetScale = typingProp?.parameterValues?.offsetScale ?? 0.125;

  // Explode parameters
  const explodeProp = explodeTrack?.animatedProps?.find(p => p.property === "explode scatter");
  const spread = explodeProp?.parameterValues?.spread ?? 800;
  const rotationAmount = explodeProp?.parameterValues?.rotationAmount ?? 720;
  const scaleEnd = explodeProp?.parameterValues?.scaleEnd ?? 0;

  // Inertia drift: starts offset right, drifts left to center with quartic easing
  // Characters appear linearly, but position follows power4.out curve
  const fontSize = Math.min(width * 0.08, 80);
  const pixelsPerChar = fontSize * avgCharWidth;
  const totalWidth = title.length * pixelsPerChar;
  const startOffset = totalWidth * offsetScale;

  // Quartic easing (power4.out) - fast start, slow end
  const easedProgress = 1 - Math.pow(1 - titleP, 4);
  const driftX = startOffset * (1 - easedProgress);

  // Seeded random per character for explosion directions
  const charSeeds = useMemo(() => {
    return title.split("").map((_, i) => {
      const seed = ((i * 7 + 13) % 100) / 100;
      return {
        angle: seed * Math.PI * 2,
        distFactor: 0.5 + seed * 0.5,
        rotDir: seed - 0.5,
      };
    });
  }, [title]);

  return (
    <CameraHost tracks={tracks}>
      <AbsoluteFill
        style={{
          backgroundColor,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "'Inter', sans-serif",
        }}
      >
        {/* Pure black background - no animated circles */}
        <div
          style={{
            fontSize: Math.min(width * 0.08, 80),
            fontWeight: 800,
            color: textColor,
            // Combine scripted drift with user-defined transforms
            transform: `translateX(${driftX + titleTranslateX}px) translateY(${titleTranslateY}px) scale(${titleScale}) rotate(${titleRotation}deg)`,
            opacity: isExploding ? 0 : titleOpacity,
            letterSpacing: "-0.03em",
            textAlign: "center",
            lineHeight: 1.1,
            padding: "0 40px",
            whiteSpace: "nowrap",
          }}
        >
          {visibleTitle}
        </div>

        {/* Exploding characters */}
        {isExploding && (
          <div
            style={{
              position: "absolute",
              display: "flex",
              fontSize: Math.min(width * 0.08, 80),
              fontWeight: 800,
              color: textColor,
              letterSpacing: "-0.03em",
              lineHeight: 1.1,
              whiteSpace: "nowrap",
              transform: `translateX(${titleTranslateX}px) translateY(${titleTranslateY}px)`,
            }}
          >
            {title.split("").map((char, i) => {
              const s = charSeeds[i];
              const dist = spread * s.distFactor * explodeP;
              const x = Math.cos(s.angle) * dist;
              const y = Math.sin(s.angle) * dist;
              const rot = s.rotDir * rotationAmount * explodeP;
              const charScale = interpolate(explodeP, [0, 1], [titleScale, scaleEnd]);
              const charOpacity = interpolate(explodeP, [0, 0.6, 1], [titleOpacity, titleOpacity * 0.5, 0]);

              return (
                <span
                  key={i}
                  style={{
                    display: "inline-block",
                    transform: `translate(${x}px, ${y}px) rotate(${rot}deg) scale(${charScale})`,
                    opacity: charOpacity,
                  }}
                >
                  {char}
                </span>
              );
            })}
          </div>
        )}
      </AbsoluteFill>
    </CameraHost>
  );
};
