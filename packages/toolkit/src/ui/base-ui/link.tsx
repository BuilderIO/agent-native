import { type LinkOwnProps, linkProps } from "@agent-native/design-system";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import { splitProps } from "./props.js";

export interface LinkProps
  extends Omit<useRender.ComponentProps<"a">, "color">, LinkOwnProps {}

/**
 * An inline link, as Radix Themes' Link. Render it as a router link or a
 * button with `render`.
 *
 * @import import { Link } from "@agent-native/toolkit/ui/base-ui/link";
 */
function Link(props: LinkProps) {
  const [attributes, { render, ...rest }] = splitProps(linkProps, props);
  return useRender({
    defaultTagName: "a",
    render,
    props: mergeProps<"a">({ className: "link", ...attributes }, rest),
  });
}

export { Link };
