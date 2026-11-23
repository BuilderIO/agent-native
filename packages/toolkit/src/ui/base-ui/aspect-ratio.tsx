import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type * as React from "react";

export interface AspectRatioProps extends useRender.ComponentProps<"div"> {
  /** Width divided by height, such as `16 / 9`. */
  ratio?: number;
}

/**
 * A box as wide as its container and as tall as its ratio makes it, as Radix
 * Themes' AspectRatio. Use it to hold an image or video at a fixed shape, with
 * the media at full width and height.
 *
 * @import import { AspectRatio } from "@agent-native/toolkit/ui/base-ui/aspect-ratio";
 */
function AspectRatio({ ratio = 1, render, ...props }: AspectRatioProps) {
  if (!Number.isFinite(ratio) || ratio <= 0) {
    throw new TypeError(`ratio=${String(ratio)} is not a positive number`);
  }
  const style: React.CSSProperties & Record<"--aspect-ratio", string> = {
    "--aspect-ratio": String(ratio),
  };
  return useRender({
    defaultTagName: "div",
    render,
    props: mergeProps<"div">({ className: "aspect-ratio", style }, props),
  });
}

export { AspectRatio };
