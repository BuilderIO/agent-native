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
  src: string;
  alt: string;
  align?: MediaAlign;
  width?: number;
  caption?: string;
  text?: string;
  autoplay?: boolean;
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
