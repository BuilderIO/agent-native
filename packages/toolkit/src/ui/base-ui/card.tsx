import { type CardOwnProps, cardProps } from "@agent-native/design-system";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import { splitProps } from "./props.js";

export interface CardProps
  extends useRender.ComponentProps<"div">, CardOwnProps {}

/**
 * A framed group of related content, as Radix Themes' Card. Rendered as a link
 * or a button with `render`, it takes hover, pressed and focus states; media in
 * an Inset inside it runs to its edge.
 *
 * @import import { Card } from "@agent-native/toolkit/ui/base-ui/card";
 */
function Card(props: CardProps) {
  const [attributes, { render, ...rest }] = splitProps(cardProps, props);
  return useRender({
    defaultTagName: "div",
    render,
    props: mergeProps<"div">({ className: "card", ...attributes }, rest),
  });
}

export { Card };
