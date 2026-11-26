import {
  type SkeletonOwnProps,
  skeletonProps,
} from "@agent-native/design-system";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { isValidElement, type ComponentProps } from "react";

import { splitProps } from "./props.js";

type OwnProps<Tag extends "div"> = ComponentProps<Tag> & {
  [attribute: `data-${string}`]: string | undefined;
};

export interface SkeletonProps
  extends useRender.ComponentProps<"div">, SkeletonOwnProps {}

/**
 * A placeholder for content that is still loading, as Radix Themes' Skeleton.
 * Around an element or text it takes that shape, and once loading ends it
 * renders its children instead.
 *
 * @import import { Skeleton } from "@agent-native/toolkit/ui/base-ui/skeleton";
 */
function Skeleton(props: SkeletonProps) {
  const [, { render, children, ...rest }] = splitProps(skeletonProps, props);
  const wrapsElement = render === undefined && isValidElement(children);
  const wrapsText = !wrapsElement && children != null && children !== false;
  const own: OwnProps<"div"> = {
    className: "skeleton",
    "aria-hidden": true,
    tabIndex: -1,
    inert: true,
    "data-inline-skeleton": wrapsText ? "" : undefined,
    ...(wrapsElement ? {} : { children }),
  };
  const element = useRender({
    defaultTagName: wrapsText ? "span" : "div",
    render: wrapsElement ? children : render,
    props: mergeProps<"div">(own, rest),
  });
  return props.loading === false ? children : element;
}

export { Skeleton };
