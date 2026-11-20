import { type StrongOwnProps, strongProps } from "@agent-native/design-system";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import { splitProps } from "./props.js";

export interface StrongProps
  extends useRender.ComponentProps<"strong">, StrongOwnProps {}

/**
 * Important text within a run of text, as Radix Themes' Strong. It is set bold
 * in the surrounding type.
 *
 * @import import { Strong } from "@agent-native/toolkit/ui/base-ui/strong";
 */
function Strong(props: StrongProps) {
  const [attributes, { render, ...rest }] = splitProps(strongProps, props);
  return useRender({
    defaultTagName: "strong",
    render,
    props: mergeProps<"strong">({ className: "strong", ...attributes }, rest),
  });
}

export { Strong };
