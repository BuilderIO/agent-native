import {
  type SeparatorOwnProps,
  separatorProps,
} from "@agent-native/design-system";
import { Separator as BaseSeparator } from "@base-ui/react/separator";
import * as React from "react";

import { partClassName } from "./part-class.js";
import { splitProps } from "./props.js";

export interface SeparatorProps
  extends Omit<BaseSeparator.Props, "color">, SeparatorOwnProps {}

/**
 * A hairline that divides content, horizontal or vertical, on Base UI's
 * Separator with Radix Themes' props.
 *
 * @import import { Separator } from "@agent-native/toolkit/ui/base-ui/separator";
 */
const Separator = React.forwardRef<HTMLDivElement, SeparatorProps>(
  ({ color = "gray", ...props }, ref) => {
    const [attributes, { className, ...rest }] = splitProps(separatorProps, {
      ...props,
      color,
    });
    return (
      <BaseSeparator
        ref={ref}
        {...rest}
        {...attributes}
        className={partClassName("separator", className)}
      />
    );
  },
);
Separator.displayName = "Separator";

export { Separator };
