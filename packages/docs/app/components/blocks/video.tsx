import { defineBlock } from "@agent-native/core/blocks";
import type { BlockReadProps } from "@agent-native/core/blocks";
import { useEffect, useState } from "react";

import { MediaFrame } from "./media-layout";
import { videoSchema, videoMdx, type VideoData } from "./video.config";

export type { VideoData };

function usePrefersReducedMotion(): boolean | null {
  const [reduced, setReduced] = useState<boolean | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      setReduced(false);
      return;
    }
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
  const shouldAutoplay =
    Boolean(data.autoplay) && prefersReducedMotion === false;

  return (
    <MediaFrame
      className="docs-video"
      align={data.align}
      width={data.width}
      caption={data.caption}
      text={data.text}
      ctx={ctx}
      media={
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
