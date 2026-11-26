import {
  type TextComponentOwnProps,
  textComponentProps,
} from "@agent-native/design-system";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import { splitProps } from "./props.js";

type TextElementProps =
  | ({ as?: "span" } & Omit<useRender.ComponentProps<"span">, "color">)
  | ({ as: "div" } & Omit<useRender.ComponentProps<"div">, "color">)
  | ({ as: "label" } & Omit<useRender.ComponentProps<"label">, "color">)
  | ({ as: "p" } & Omit<useRender.ComponentProps<"p">, "color">);

export type TextProps = Omit<TextComponentOwnProps, "as"> & TextElementProps;

/**
 * Running text, as Radix Themes' Text, on a step of the type scale or the
 * surrounding text's size. Use it for any copy that isn't a heading.
 *
 * @import import { Text } from "@agent-native/toolkit/ui/base-ui/text";
 */
function Text(props: TextProps) {
  const [{ "data-as": _as, ...attributes }, { render, ...rest }] = splitProps(
    textComponentProps,
    props,
  );
  return useRender({
    defaultTagName: props.as ?? textComponentProps.as.default,
    render,
    props: mergeProps({ className: "text", ...attributes }, rest),
  });
}

export { Text };
