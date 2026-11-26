import {
  type HeadingOwnProps,
  headingProps,
} from "@agent-native/design-system";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import { splitProps } from "./props.js";

export interface HeadingProps
  extends Omit<useRender.ComponentProps<"h1">, "color">, HeadingOwnProps {}

/**
 * A title for a page or section, as Radix Themes' Heading. The heading level
 * and the size are chosen apart, so the outline never dictates the look.
 *
 * @import import { Heading } from "@agent-native/toolkit/ui/base-ui/heading";
 */
function Heading(props: HeadingProps) {
  const [{ "data-as": _as, ...attributes }, { render, ...rest }] = splitProps(
    headingProps,
    props,
  );
  return useRender({
    defaultTagName: props.as ?? headingProps.as.default,
    render,
    props: mergeProps<"h1">({ className: "heading", ...attributes }, rest),
  });
}

export { Heading };
