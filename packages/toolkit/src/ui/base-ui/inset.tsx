import { type InsetOwnProps, insetProps } from "@agent-native/design-system";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import { splitProps } from "./props.js";

export interface InsetProps
  extends useRender.ComponentProps<"div">, InsetOwnProps {}

/**
 * Content inside a Card that runs to the card's edge, such as a cover image,
 * as Radix Themes' Inset. It follows the card's padding and radius.
 *
 * @import import { Inset } from "@agent-native/toolkit/ui/base-ui/inset";
 */
function Inset(props: InsetProps) {
  const [attributes, { render, ...rest }] = splitProps(insetProps, props);
  return useRender({
    defaultTagName: "div",
    render,
    props: mergeProps<"div">({ className: "inset", ...attributes }, rest),
  });
}

export { Inset };
