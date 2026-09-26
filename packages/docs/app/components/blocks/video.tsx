import { defineBlock } from "@agent-native/core/blocks";
import type { BlockReadProps } from "@agent-native/core/blocks";
import { useRef } from "react";

import { usePrefersReducedMotion } from "../use-prefers-reduced-motion";
import { MediaFrame } from "./media-layout";
import { videoSchema, videoMdx, type VideoData } from "./video.config";

export type { VideoData };

export function VideoBlock({ data, ctx }: BlockReadProps<VideoData>) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const prefersReducedMotion = usePrefersReducedMotion(videoRef);
  // Autoplay only fires once the reduced-motion preference has resolved.
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
        // `<video>` has no native `alt`; `aria-label` is its text alternative.
        <video
          ref={videoRef}
          src={data.src}
          aria-label={data.alt}
          controls
          preload="metadata"
          autoPlay={shouldAutoplay}
          muted={shouldAutoplay}
          playsInline
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
