import { defineBlock } from "@agent-native/core/blocks";
import type { BlockReadProps } from "@agent-native/core/blocks";
import { useEffect, useState } from "react";

import { MediaFrame } from "./media-layout";
import { videoSchema, videoMdx, type VideoData } from "./video.config";

export type { VideoData };

/**
 * Tracks `prefers-reduced-motion: reduce`. Starts `false` (matches SSR, where
 * there's no `window` to ask) and updates after mount, so a reduced-motion
 * viewer never sees a flash of autoplay before it's suppressed.
 */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

export function VideoBlock({ data, ctx }: BlockReadProps<VideoData>) {
  const prefersReducedMotion = usePrefersReducedMotion();
  // Autoplay only fires when requested AND the viewer hasn't asked for less
  // motion. Muted/playsInline are tied to that same resolved decision, not to
  // the raw `autoplay` flag: a reduced-motion viewer who presses play
  // themselves gets a normal, unmuted playback, not a silently-muted one.
  const shouldAutoplay = Boolean(data.autoplay) && !prefersReducedMotion;

  return (
    <MediaFrame
      className="docs-video"
      align={data.align}
      width={data.width}
      caption={data.caption}
      text={data.text}
      ctx={ctx}
      media={
        // `<video>` has no native `alt`; `aria-label` is its text alternative.
        <video
          src={data.src}
          aria-label={data.alt}
          controls
          preload="metadata"
          autoPlay={shouldAutoplay}
          muted={shouldAutoplay}
          playsInline={shouldAutoplay}
          loop={Boolean(data.loop)}
        />
      }
    />
  );
}

export const videoBlock = defineBlock<VideoData>({
  type: "video",
  schema: videoSchema,
  mdx: videoMdx,
  Read: VideoBlock,
  placement: ["block"],
  label: "Video",
  description:
    "A direct-file video (mp4/webm), full width or aligned left/right with paired markdown text, an optional caption, reduced-motion-aware autoplay, and looping.",
  empty: () => ({
    src: "/videos/example.mp4",
    alt: "Describe the video for screen readers.",
    align: "full",
  }),
});
