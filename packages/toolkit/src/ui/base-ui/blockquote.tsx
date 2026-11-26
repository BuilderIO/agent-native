import {
  type BlockquoteOwnProps,
  blockquoteProps,
} from "@agent-native/design-system";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import { splitProps } from "./props.js";

export interface BlockquoteProps
  extends
    Omit<useRender.ComponentProps<"blockquote">, "color">,
    BlockquoteOwnProps {}

/**
 * A block of quoted text with a rule down its start edge, as Radix Themes'
 * Blockquote. For a quote inside a sentence, use Quote.
 *
 * @import import { Blockquote } from "@agent-native/toolkit/ui/base-ui/blockquote";
 */
function Blockquote(props: BlockquoteProps) {
  const [attributes, { render, ...rest }] = splitProps(blockquoteProps, props);
  return useRender({
    defaultTagName: "blockquote",
    render,
    props: mergeProps<"blockquote">(
      { className: "blockquote", ...attributes },
      rest,
    ),
  });
}

export { Blockquote };
