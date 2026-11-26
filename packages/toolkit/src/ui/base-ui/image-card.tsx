import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cloneElement, isValidElement, type ButtonHTMLAttributes } from "react";

import { cn } from "../../utils.js";
import { Card, type CardProps } from "./card.js";

/**
 * An illustrated card. Compose its media, heading, description, and optional
 * actions. Use Inset around the media for a full-bleed cover.
 * @import import { ImageCard, ImageCardMedia, ImageCardBody, ImageCardTarget, ImageCardActions } from "@agent-native/toolkit/ui/base-ui/image-card";
 */
export function ImageCard({ className, ...props }: CardProps) {
  return <Card {...props} className={cn("image-card", className)} />;
}

/** Extends a heading's link or button over the card. Render a link for navigation or a DialogTrigger for details. */
export function ImageCardTarget({
  render,
  ...props
}: useRender.ComponentProps<"button">) {
  const target = useRender({
    defaultTagName: "button",
    render,
    props: mergeProps<"button">({ className: "image-card-target" }, props),
  });
  if (
    target.type === "button" &&
    isValidElement<ButtonHTMLAttributes<HTMLButtonElement>>(target) &&
    target.props.type == null
  )
    return cloneElement(target, { type: "button" });
  return target;
}

function createSlot(className: string) {
  return function Slot({ render, ...props }: useRender.ComponentProps<"div">) {
    return useRender({
      defaultTagName: "div",
      render,
      props: mergeProps<"div">({ className }, props),
    });
  };
}

/** Holds an image, a video with native controls, or caller-supplied artwork. */
export const ImageCardMedia = createSlot("image-card-media");
/** Accepts headings, descriptions, lists and any other feature content. */
export const ImageCardBody = createSlot("image-card-body");
/** Keeps links and buttons independently reachable above the card trigger. */
export const ImageCardActions = createSlot("image-card-actions");
