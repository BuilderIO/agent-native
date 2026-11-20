import { type QuoteOwnProps, quoteProps } from "@agent-native/design-system";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import { splitProps } from "./props.js";

export interface QuoteProps
  extends useRender.ComponentProps<"q">, QuoteOwnProps {}

/**
 * An inline quotation within running text, as Radix Themes' Quote. It is set in
 * italic in the surrounding type, and the browser adds the quotation marks.
 *
 * @import import { Quote } from "@agent-native/toolkit/ui/base-ui/quote";
 */
function Quote(props: QuoteProps) {
  const [attributes, { render, ...rest }] = splitProps(quoteProps, props);
  return useRender({
    defaultTagName: "q",
    render,
    props: mergeProps<"q">({ className: "quote", ...attributes }, rest),
  });
}

export { Quote };
