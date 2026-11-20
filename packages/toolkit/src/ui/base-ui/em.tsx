import { type EmOwnProps, emProps } from "@agent-native/design-system";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import { splitProps } from "./props.js";

export interface EmProps extends useRender.ComponentProps<"em">, EmOwnProps {}

/**
 * Stressed text, as Radix Themes' Em: italic in the surrounding text's
 * family, size and color.
 *
 * @import import { Em } from "@agent-native/toolkit/ui/base-ui/em";
 */
function Em(props: EmProps) {
  const [attributes, { render, ...rest }] = splitProps(emProps, props);
  return useRender({
    defaultTagName: "em",
    render,
    props: mergeProps<"em">({ className: "em", ...attributes }, rest),
  });
}

export { Em };
