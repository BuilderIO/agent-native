import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { AnimationTrack } from "@/types";
import { trackProgress, getPropValue, findTrack } from "../trackAnimation";
import { CameraHost } from "../CameraHost";
import { useMemo } from "react";
import {
  LOGO_PIECES,
  LOGO_VIEWBOX_W,
  LOGO_VIEWBOX_H,
} from "./BuilderLogoPaths";

export type LogoExplodeProps = {
  bgColor: string;
  logoScale: number;
  tracks?: AnimationTrack[];
};

const FALLBACK_TRACKS: AnimationTrack[] = [
  {
    id: "le-logo",
    label: "Logo Entrance",
    startFrame: 0,
    endFrame: 45,
    easing: "spring",
    animatedProps: [
      { property: "scale", from: "0.3", to: "1", unit: "" },
      { property: "opacity", from: "0", to: "1", unit: "" },
    ],
  },
  {
    id: "le-explode",
    label: "Letter Explosion",
    startFrame: 60,
    endFrame: 120,
    easing: "power2.out",
    animatedProps: [
      {
        property: "letter scatter",
        from: "",
        to: "",
        unit: "",
        programmatic: true,
        description:
          "Each piece of the Builder.io logo gets its own random explosion vector — angle, speed, and rotation direction. Pieces spring outward from their resting position, spin, shrink, and fade out with staggered timing for an organic shatter feel.",
        parameters: [
          {
            name: "spreadRadius",
            label: "Spread Radius",
            default: 500,
            min: 100,
            max: 1200,
            step: 25,
          },
          {
            name: "stagger",
            label: "Stagger (frames)",
            default: 2,
            min: 0,
            max: 8,
            step: 1,
          },
        ],
        codeSnippet: `// Per-piece spring with stagger
const p = spring({ frame, fps, delay: startFrame + i * stagger,
  config: { damping: 20, stiffness: 40 } });
const dx = Math.cos(angle) * speed * spreadRadius * p;
const dy = Math.sin(angle) * speed * spreadRadius * p;
const rot = rotDir * (360 + rand() * 360) * p;
const pieceOpacity = interpolate(elapsed, [0, dur*0.5, dur], [1, 0.7, 0]);
const pieceScale = interpolate(elapsed, [0, dur], [1, 0.1]);`,
      },
    ],
  },
];

/** Simple seeded PRNG for deterministic explosion vectors */
function createSeededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

interface PiecePhysics {
  angle: number;
  speed: number;
  rotDir: number;
  rotAmount: number;
}

export const LogoExplode: React.FC<LogoExplodeProps> = ({
  bgColor,
  logoScale = 1,
  tracks = FALLBACK_TRACKS,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  // --- Tracks ---
  const logoTrack = findTrack(tracks, "le-logo", FALLBACK_TRACKS[0]);
  const explodeTrack = findTrack(tracks, "le-explode", FALLBACK_TRACKS[1]);

  // --- Logo entrance ---
  const logoP = trackProgress(frame, fps, logoTrack);
  const logoEntranceScale = getPropValue(logoP, logoTrack, "scale", 0.3, 1);
  const logoEntranceOpacity = getPropValue(logoP, logoTrack, "opacity", 0, 1);

  // --- Explosion parameters ---
  const scatterProp = explodeTrack.animatedProps?.find(
    (p) => p.property === "letter scatter",
  );
  const spreadRadius = scatterProp?.parameterValues?.spreadRadius ?? 500;
  const stagger = scatterProp?.parameterValues?.stagger ?? 2;

  const explosionStarted = frame >= explodeTrack.startFrame;
  const explosionDuration = explodeTrack.endFrame - explodeTrack.startFrame;

  // --- Per-piece explosion vectors (deterministic) ---
  const piecePhysics = useMemo<PiecePhysics[]>(() => {
    const rand = createSeededRandom(77);
    const logoCX = LOGO_VIEWBOX_W / 2;
    const logoCY = LOGO_VIEWBOX_H / 2;
    return LOGO_PIECES.map((piece) => {
      // Base angle points outward from logo center
      const baseAngle = Math.atan2(piece.cy - logoCY, piece.cx - logoCX);
      // Add some random spread (±45°) so it's not perfectly radial
      const angleJitter = (rand() - 0.5) * (Math.PI / 2);
      return {
        angle: baseAngle + angleJitter,
        speed: 0.4 + rand() * 0.8,
        rotDir: rand() > 0.5 ? 1 : -1,
        rotAmount: 360 + rand() * 540,
      };
    });
  }, []);

  // --- SVG scaling: fit logo into composition ---
  const margin = 0.15;
  const availableW = width * (1 - margin * 2);
  const availableH = height * (1 - margin * 2);
  const svgScale =
    Math.min(availableW / LOGO_VIEWBOX_W, availableH / LOGO_VIEWBOX_H) *
    logoScale;

  return (
    <CameraHost tracks={tracks}>
      <AbsoluteFill
        style={{
          backgroundColor: bgColor,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg
          viewBox={`0 0 ${LOGO_VIEWBOX_W} ${LOGO_VIEWBOX_H}`}
          width={LOGO_VIEWBOX_W * svgScale}
          height={LOGO_VIEWBOX_H * svgScale}
          style={{ overflow: "visible" }}
        >
          {LOGO_PIECES.map((piece, i) => {
            const phys = piecePhysics[i];

            if (!explosionStarted) {
              const s = logoEntranceScale;
              const logoCX = LOGO_VIEWBOX_W / 2;
              const logoCY = LOGO_VIEWBOX_H / 2;
              return (
                <g
                  key={piece.id}
                  transform={`translate(${logoCX * (1 - s)}, ${logoCY * (1 - s)}) scale(${s})`}
                  opacity={logoEntranceOpacity}
                >
                  <path d={piece.d} fill={piece.fill} />
                </g>
              );
            }

            // Explosion phase
            const pieceDelay = explodeTrack.startFrame + i * stagger;
            const elapsed = frame - pieceDelay;

            const p = spring({
              frame,
              fps,
              delay: pieceDelay,
              config: { damping: 20, stiffness: 40 },
            });

            const dx =
              (Math.cos(phys.angle) * phys.speed * spreadRadius * p) / svgScale;
            const dy =
              (Math.sin(phys.angle) * phys.speed * spreadRadius * p) / svgScale;
            const rot = phys.rotDir * phys.rotAmount * p;

            const pieceOpacity =
              elapsed < 0
                ? 1
                : interpolate(
                    elapsed,
                    [0, explosionDuration * 0.5, explosionDuration],
                    [1, 0.7, 0],
                    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
                  );

            const pieceScale =
              elapsed < 0
                ? 1
                : interpolate(elapsed, [0, explosionDuration], [1, 0.1], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                  });

            return (
              <g
                key={piece.id}
                transform={`translate(${piece.cx + dx}, ${piece.cy + dy}) rotate(${rot}) scale(${pieceScale}) translate(${-piece.cx}, ${-piece.cy})`}
                opacity={pieceOpacity}
              >
                <path d={piece.d} fill={piece.fill} />
              </g>
            );
          })}
        </svg>
      </AbsoluteFill>
    </CameraHost>
  );
};
