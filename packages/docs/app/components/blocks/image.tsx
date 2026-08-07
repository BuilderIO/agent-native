import { defineBlock } from "@agent-native/core/blocks";
import type { BlockReadProps } from "@agent-native/core/blocks";

import { imageSchema, imageMdx, type ImageData } from "./image.config";
import { MediaFrame } from "./media-layout";

export type { ImageData };

export function ImageBlock({ data, ctx }: BlockReadProps<ImageData>) {
  return (
    <MediaFrame
      className="docs-image"
      align={data.align}
      width={data.width}
      caption={data.caption}
      text={data.text}
      ctx={ctx}
      media={<img src={data.src} alt={data.alt} loading="lazy" />}
    />
  );
}

export const imageBlock = defineBlock<ImageData>({
  type: "image",
  schema: imageSchema,
  mdx: imageMdx,
  Read: ImageBlock,
  placement: ["block"],
  label: "Image",
  description:
    "An image, full width or aligned left/right with paired markdown text and an optional caption.",
  empty: () => ({
    src: "/images/example.png",
    alt: "Describe the image for screen readers.",
    align: "full",
  }),
});
