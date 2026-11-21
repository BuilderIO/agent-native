import { type KbdOwnProps, kbdProps } from "@agent-native/design-system";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import { splitProps } from "./props.js";

export interface KbdProps
  extends useRender.ComponentProps<"kbd">, KbdOwnProps {}

/**
 * A keyboard shortcut, as Radix Themes' Kbd. One Kbd holds a whole shortcut,
 * such as ⇧⌘P.
 *
 * @import import { Kbd } from "@agent-native/toolkit/ui/base-ui/kbd";
 */
function Kbd(props: KbdProps) {
  const [attributes, { render, ...rest }] = splitProps(kbdProps, props);
  return useRender({
    defaultTagName: "kbd",
    render,
    props: mergeProps<"kbd">({ className: "kbd", ...attributes }, rest),
  });
}

export { Kbd };
