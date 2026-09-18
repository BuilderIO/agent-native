import type { BlockMdxConfig } from "@agent-native/core/blocks";
import { z } from "zod";

import {
  mediaAlignSchema,
  mediaCaptionSchema,
  mediaSrcSchema,
  mediaTextSchema,
  mediaWidthSchema,
  type MediaAlign,
} from "./media-shared";

export interface VideoData {
  /** Direct video file URL (mp4/webm), not a third-party embed iframe. */
  src: string;
  alt: string;
  align?: MediaAlign;
  width?: number;
  caption?: string;
  /** Markdown paired text shown beside the video when aligned left/right. */
  text?: string;
  /**
   * Autoplay on load. The renderer always forces `muted` alongside this
   * (browsers block autoplay with sound) and skips autoplaying entirely for
   * viewers with `prefers-reduced-motion: reduce`, who instead get a normal
   * paused player with full (unmuted) playback once they press play.
   */
  autoplay?: boolean;
  /** Restart from the beginning on end, independent of `autoplay`. */
  loop?: boolean;
}

export const videoSchema = z.object({
  src: mediaSrcSchema,
  alt: z.string().trim().min(1).max(400),
  align: mediaAlignSchema,
  width: mediaWidthSchema,
  caption: mediaCaptionSchema,
  text: mediaTextSchema,
  autoplay: z.boolean().optional(),
  loop: z.boolean().optional(),
}) as unknown as z.ZodType<VideoData>;

/**
 * MDX config: `<Video src alt align width caption autoplay loop>text</Video>`,
 * mirroring `image.config.ts` (minus `autoplay`/`loop`) so the two blocks stay
 * in lockstep.
 */
export const videoMdx: BlockMdxConfig<VideoData> = {
  tag: "Video",
  childrenField: "text",
  toAttrs: (data) => ({
    src: data.src,
    alt: data.alt,
    align: data.align,
    width: data.width,
    caption: data.caption,
    autoplay: data.autoplay,
    loop: data.loop,
  }),
  fromAttrs: (attrs, children) => ({
    src: attrs.string("src") ?? "",
    alt: attrs.string("alt") ?? "",
    align: attrs.string("align") as MediaAlign | undefined,
    width: attrs.number("width"),
    caption: attrs.string("caption"),
    text: children.trim() ? children : undefined,
    autoplay: attrs.bool("autoplay"),
    loop: attrs.bool("loop"),
  }),
};
