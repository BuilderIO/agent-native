import { defineBlock } from "@agent-native/core/blocks";
import type { BlockReadProps } from "@agent-native/core/blocks";

import { BuilderImage } from "../builder-image";
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
      media={
        <BuilderImage
          src={data.src}
          alt={data.alt}
          sizes={
            data.align && data.text
              ? `(max-width: 900px) 100vw, ${data.width ?? 400}px`
              : "(max-width: 900px) 100vw, 900px"
          }
          width={data.width}
          loading="lazy"
          decoding="async"
        />
      }
      expandable
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
    "An image, full width or aligned left/right with paired markdown text, an optional caption, and a hover-to-expand popup.",
  empty: () => ({
    src: "/images/example.png",
    alt: "Describe the image for screen readers.",
    align: "full",
  }),
});
