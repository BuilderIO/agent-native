import {
  type CalloutOwnProps,
  calloutProps,
} from "@agent-native/design-system";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import { splitProps } from "./props.js";

export interface CalloutProps
  extends Omit<useRender.ComponentProps<"div">, "color">, CalloutOwnProps {}

/**
 * A message that stands in a page or list, as Radix Themes' Callout, holding a
 * CalloutIcon and one or more CalloutTexts. A warning is amber with a triangle
 * icon; only something destroyed is `danger`.
 *
 * @import import { Callout, CalloutIcon, CalloutText, CalloutActions } from "@agent-native/toolkit/ui/base-ui/callout";
 */
function Callout(props: CalloutProps) {
  const [attributes, { render, ...rest }] = splitProps(calloutProps, props);
  return useRender({
    defaultTagName: "div",
    render,
    props: mergeProps<"div">({ className: "callout", ...attributes }, rest),
  });
}

export type CalloutIconProps = useRender.ComponentProps<"div">;

/**
 * The icon before the message, decorative unless given a name.
 *
 * @import import { CalloutIcon } from "@agent-native/toolkit/ui/base-ui/callout";
 */
function CalloutIcon({ render, ...props }: CalloutIconProps) {
  return useRender({
    defaultTagName: "div",
    render,
    props: mergeProps<"div">(
      { className: "callout-icon", "aria-hidden": true },
      props,
    ),
  });
}

export type CalloutTextProps = useRender.ComponentProps<"p">;

/**
 * A paragraph of the callout's message.
 *
 * @import import { CalloutText } from "@agent-native/toolkit/ui/base-ui/callout";
 */
function CalloutText({ render, ...props }: CalloutTextProps) {
  return useRender({
    defaultTagName: "p",
    render,
    props: mergeProps<"p">({ className: "callout-text" }, props),
  });
}

export type CalloutActionsProps = useRender.ComponentProps<"div">;

/**
 * The controls at the message's end that answer it, such as a Retry button.
 * Radix Themes' Callout has no such part.
 *
 * @import import { CalloutActions } from "@agent-native/toolkit/ui/base-ui/callout";
 */
function CalloutActions({ render, ...props }: CalloutActionsProps) {
  return useRender({
    defaultTagName: "div",
    render,
    props: mergeProps<"div">({ className: "callout-actions" }, props),
  });
}

export { Callout, CalloutIcon, CalloutText, CalloutActions };
