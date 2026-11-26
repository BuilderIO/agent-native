import { type CodeOwnProps, codeProps } from "@agent-native/design-system";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import { splitProps } from "./props.js";

export interface CodeProps
  extends Omit<useRender.ComponentProps<"code">, "color">, CodeOwnProps {}

/**
 * Inline code, such as a command, a key or a value, as Radix Themes' Code.
 * Unset, its size follows the surrounding text.
 *
 * @import import { Code } from "@agent-native/toolkit/ui/base-ui/code";
 */
function Code(props: CodeProps) {
  const [attributes, { render, ...rest }] = splitProps(codeProps, props);
  return useRender({
    defaultTagName: "code",
    render,
    props: mergeProps<"code">({ className: "code", ...attributes }, rest),
  });
}

export { Code };
