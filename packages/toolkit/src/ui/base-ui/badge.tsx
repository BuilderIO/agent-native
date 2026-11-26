import { type BadgeOwnProps, badgeProps } from "@agent-native/design-system";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import { splitProps } from "./props.js";

export interface BadgeProps
  extends Omit<useRender.ComponentProps<"span">, "color">, BadgeOwnProps {}

/**
 * A short static label, such as a release stage, a status or a count, as Radix
 * Themes' Badge. It has no behavior; Base UI's `render` renders it as another
 * element.
 *
 * @import import { Badge } from "@agent-native/toolkit/ui/base-ui/badge";
 */
function Badge(props: BadgeProps) {
  const [attributes, { render, ...rest }] = splitProps(badgeProps, props);
  return useRender({
    defaultTagName: "span",
    render,
    props: mergeProps<"span">({ className: "badge", ...attributes }, rest),
  });
}

export { Badge };
