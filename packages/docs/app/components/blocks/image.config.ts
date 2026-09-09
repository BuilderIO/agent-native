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

export interface ImageData {
  src: string;
  alt: string;
  align?: MediaAlign;
  width?: number;
  caption?: string;
  /** Markdown paired text shown beside the image when aligned left/right. */
  text?: string;
}

export const imageSchema = z.object({
  src: mediaSrcSchema,
  alt: z.string().trim().min(1).max(400),
  align: mediaAlignSchema,
  width: mediaWidthSchema,
  caption: mediaCaptionSchema,
  text: mediaTextSchema,
}) as unknown as z.ZodType<ImageData>;

/**
 * MDX config: `<Image src alt align width caption>text</Image>`. `text` is
 * MDX children (like `Callout`'s body), so it round-trips as real markdown
 * rather than a flat attribute. Self-closing (`<Image ... />`) is valid too —
 * `text` decodes to `undefined` when there are no children.
 */
export const imageMdx: BlockMdxConfig<ImageData> = {
  tag: "Image",
  childrenField: "text",
  toAttrs: (data) => ({
    src: data.src,
    alt: data.alt,
    align: data.align,
    width: data.width,
    caption: data.caption,
  }),
  fromAttrs: (attrs, children) => ({
    src: attrs.string("src") ?? "",
    alt: attrs.string("alt") ?? "",
    align: attrs.string("align") as MediaAlign | undefined,
    width: attrs.number("width"),
    caption: attrs.string("caption"),
    text: children.trim() ? children : undefined,
  }),
};
