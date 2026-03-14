import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  Sequence,
} from "remotion";
import type { AnimationTrack, AnimatedProp } from "@/types";
import { CameraHost } from "../CameraHost";

type Slide = {
  title: string;
  body: string;
  color: string;
};

export type SlideshowProps = {
  slides: Slide[];
  fontColor: string;
  tracks?: AnimationTrack[];
};

const FALLBACK_TRACKS: AnimationTrack[] = [
  {
    id: "ss-slide1", label: "Slide 1 — Enter", startFrame: 0, endFrame: 90, easing: "spring",
    animatedProps: [
      { property: "translateX", from: "-80", to: "0", unit: "px" },
      { property: "opacity",    from: "0",   to: "1", unit: ""   },
    ],
  },
  {
    id: "ss-slide2", label: "Slide 2 — Enter", startFrame: 90, endFrame: 180, easing: "spring",
    animatedProps: [
      { property: "translateX", from: "-80", to: "0", unit: "px" },
      { property: "opacity",    from: "0",   to: "1", unit: ""   },
    ],
  },
  {
    id: "ss-slide3", label: "Slide 3 — Enter", startFrame: 180, endFrame: 270, easing: "spring",
    animatedProps: [
      { property: "translateX", from: "-80", to: "0", unit: "px" },
      { property: "opacity",    from: "0",   to: "1", unit: ""   },
    ],
  },
];

/** Pull a numeric value pair from an animatedProps list with defaults */
function propRange(
  animatedProps: AnimatedProp[] | undefined,
  property: string,
  defFrom: number,
  defTo: number
): [number, number] {
  const p = animatedProps?.find((a) => a.property === property);
  const from = p ? parseFloat(p.from) : NaN;
  const to   = p ? parseFloat(p.to)   : NaN;
  return [Number.isFinite(from) ? from : defFrom, Number.isFinite(to) ? to : defTo];
}

const SlideComponent: React.FC<{
  title: string;
  body: string;
  color: string;
  fontColor: string;
  animatedProps?: AnimatedProp[];
}> = ({ title, body, color, fontColor, animatedProps }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();

  const enterP = spring({ frame, fps, config: { damping: 200 } });
  const bodyP  = spring({ frame, fps, delay: 8, config: { damping: 200 } });

  const [txFrom, txTo] = propRange(animatedProps, "translateX", -80, 0);
  const [opFrom, opTo] = propRange(animatedProps, "opacity",    0,   1);

  const titleX  = interpolate(enterP, [0, 1], [txFrom, txTo]);
  const titleOp = interpolate(enterP, [0, 1], [opFrom, opTo]);
  const bodyY   = interpolate(bodyP,  [0, 1], [30, 0]);
  const bodyOp  = interpolate(bodyP,  [0, 1], [0, 0.75]);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: color,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "60px",
        fontFamily: "'Inter', sans-serif",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: width * 0.8 }}>
        <div
          style={{
            fontSize: Math.min(width * 0.065, 64),
            fontWeight: 800,
            color: fontColor,
            transform: `translateX(${titleX}px)`,
            opacity: titleOp,
            letterSpacing: "-0.03em",
            lineHeight: 1.1,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: Math.min(width * 0.03, 28),
            fontWeight: 400,
            color: fontColor,
            opacity: bodyOp,
            transform: `translateY(${bodyY}px)`,
            lineHeight: 1.5,
          }}
        >
          {body}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const Slideshow: React.FC<SlideshowProps> = ({
  slides,
  fontColor,
  tracks = FALLBACK_TRACKS,
}) => {
  const { fps } = useVideoConfig();
  const framesToShowPerSlide = 3 * fps;

  return (
    <CameraHost tracks={tracks}>
      <AbsoluteFill>
      {slides.map((slide, i) => {
        const track    = tracks.find((t) => t.id === `ss-slide${i + 1}`);
        const from     = track?.startFrame ?? i * framesToShowPerSlide;
        const duration = track
          ? track.endFrame - track.startFrame
          : framesToShowPerSlide;

        return (
          <Sequence key={i} from={from} durationInFrames={Math.max(1, duration)}>
            <SlideComponent
              title={slide.title}
              body={slide.body}
              color={slide.color}
              fontColor={fontColor}
              animatedProps={track?.animatedProps}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
    </CameraHost>
  );
};
