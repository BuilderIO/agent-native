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

export type LogoRevealProps = {
  brandName: string;
  tagline: string;
  primaryColor: string;
  bgColor: string;
  tracks?: AnimationTrack[];
};

const FALLBACK_TRACKS: AnimationTrack[] = [
  {
    id: "lr-ring", label: "Ring Expand", startFrame: 0, endFrame: 30, easing: "spring",
    animatedProps: [
      { property: "scale",   from: "0", to: "1",   unit: "" },
      { property: "opacity", from: "0", to: "0.4", unit: "" },
    ],
  },
  {
    id: "lr-particles", label: "Particles Burst", startFrame: 8, endFrame: 55, easing: "ease-out",
    animatedProps: [
      { property: "radius",  from: "0",   to: "35",  unit: "%" },
      { property: "opacity", from: "1",   to: "0",   unit: "" },
    ],
  },
  {
    id: "lr-logo", label: "Logo Entrance", startFrame: 12, endFrame: 45, easing: "spring",
    animatedProps: [
      { property: "scale",   from: "0.5", to: "1", unit: "" },
      { property: "opacity", from: "0",   to: "1", unit: "" },
    ],
  },
  {
    id: "lr-tagline", label: "Tagline Fade", startFrame: 25, endFrame: 60, easing: "spring",
    animatedProps: [
      { property: "translateY", from: "20",  to: "0",   unit: "px" },
      { property: "opacity",    from: "0",   to: "0.6", unit: ""   },
    ],
  },
];

export const LogoReveal: React.FC<LogoRevealProps> = ({
  brandName,
  tagline,
  primaryColor,
  bgColor,
  tracks = FALLBACK_TRACKS,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const ringTrack     = findTrack(tracks, "lr-ring",      FALLBACK_TRACKS[0]);
  const particleTrack = findTrack(tracks, "lr-particles",  FALLBACK_TRACKS[1]);
  const logoTrack     = findTrack(tracks, "lr-logo",      FALLBACK_TRACKS[2]);
  const taglineTrack  = findTrack(tracks, "lr-tagline",   FALLBACK_TRACKS[3]);

  // Ring — spring expand from ringTrack.startFrame, from/to scale read from animatedProps
  const ringSpring = spring({ frame, fps, delay: ringTrack.startFrame, config: { damping: 12, stiffness: 80 } });
  const ringScaleVal   = getPropValue(ringSpring, ringTrack,  "scale",   0, 1);
  const ringOpacityVal = getPropValue(ringSpring, ringTrack,  "opacity", 0, 0.4);

  // Logo
  const logoP        = trackProgress(frame, fps, logoTrack);
  const logoScaleVal = getPropValue(logoP, logoTrack, "scale",   0.5, 1);
  const logoOpVal    = getPropValue(logoP, logoTrack, "opacity", 0,   1);

  // Tagline
  const taglineP  = trackProgress(frame, fps, taglineTrack);
  const taglineY  = getPropValue(taglineP, taglineTrack, "translateY", 20,  0);
  const taglineOp = getPropValue(taglineP, taglineTrack, "opacity",    0,   0.6);

  // Particles — staggered burst offset from particleTrack.startFrame
  // radius: read from animatedProps as % of min(width,height), e.g. "35" = 35%
  const radiusFromPct = parseFloat(particleTrack.animatedProps?.find(a => a.property === "radius")?.from ?? "0");
  const radiusToPct   = parseFloat(particleTrack.animatedProps?.find(a => a.property === "radius")?.to   ?? "35");
  const maxDim = Math.min(width, height);
  const radiusFrom = maxDim * (radiusFromPct / 100);
  const radiusTo   = maxDim * (radiusToPct   / 100);

  const opFrom = parseFloat(particleTrack.animatedProps?.find(a => a.property === "opacity")?.from ?? "1");
  const opTo   = parseFloat(particleTrack.animatedProps?.find(a => a.property === "opacity")?.to   ?? "0");

  const particles = Array.from({ length: 24 }).map((_, i) => {
    const angle = (i / 24) * Math.PI * 2;
    const delay = particleTrack.startFrame + i * 2;
    const p = spring({ frame, fps, delay, config: { damping: 20 } });
    const radius = interpolate(p, [0, 1], [radiusFrom, radiusTo]);
    const fadeOut = interpolate(frame, [delay + 20, delay + 40], [opFrom, opTo], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    return {
      x: width / 2 + Math.cos(angle) * radius,
      y: height / 2 + Math.sin(angle) * radius,
      opacity: fadeOut,
      size: 6,
    };
  });

  return (
    <CameraHost tracks={tracks}>
      <AbsoluteFill
      style={{
        backgroundColor: bgColor,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Inter', sans-serif",
      }}
    >
      {/* Expanding ring */}
      <div
        style={{
          position: "absolute",
          width: Math.min(width, height) * 0.5,
          height: Math.min(width, height) * 0.5,
          borderRadius: "50%",
          border: `3px solid ${primaryColor}`,
          transform: `scale(${ringScaleVal})`,
          opacity: ringOpacityVal,
        }}
      />

      {/* Particles */}
      {particles.map((particle, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: particle.x - particle.size / 2,
            top: particle.y - particle.size / 2,
            width: particle.size,
            height: particle.size,
            borderRadius: "50%",
            backgroundColor: primaryColor,
            opacity: particle.opacity,
          }}
        />
      ))}

      {/* Logo + tagline */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, zIndex: 1 }}>
        <div
          style={{
            fontSize: Math.min(width * 0.1, 96),
            fontWeight: 800,
            color: primaryColor,
            transform: `scale(${logoScaleVal})`,
            opacity: logoOpVal,
            letterSpacing: "-0.04em",
          }}
        >
          {brandName}
        </div>

        <div
          style={{
            fontSize: Math.min(width * 0.025, 22),
            fontWeight: 400,
            color: primaryColor,
            opacity: taglineOp,
            transform: `translateY(${taglineY}px)`,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          {tagline}
        </div>
      </div>
    </AbsoluteFill>
    </CameraHost>
  );
};
