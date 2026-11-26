import {
  type CheckboxOwnProps,
  checkboxProps,
} from "@agent-native/design-system";
import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { IconCheck, IconMinus } from "@tabler/icons-react";
import * as React from "react";

import { checkboxGroupItemProps } from "./checkbox-group.js";
import { partClassName } from "./part-class.js";
import { splitProps } from "./props.js";

export type CheckboxIndicatorProps = BaseCheckbox.Indicator.Props;

const CheckboxIndicator = React.forwardRef<
  HTMLSpanElement,
  CheckboxIndicatorProps
>(({ className, ...props }, ref) => (
  <BaseCheckbox.Indicator
    {...props}
    ref={ref}
    className={partClassName("checkbox-indicator", className)}
  />
));
CheckboxIndicator.displayName = "CheckboxIndicator";

export interface CheckboxProps
  extends Omit<BaseCheckbox.Root.Props, "color">, CheckboxOwnProps {}

/**
 * A box that turns one option on and off, on Base UI's Checkbox with Radix
 * Themes' props. It draws a check while checked and a dash while indeterminate,
 * and inside a CheckboxGroup takes the group's look as its defaults.
 *
 * @import import { Checkbox } from "@agent-native/toolkit/ui/base-ui/checkbox";
 */
const Checkbox = React.forwardRef<HTMLElement, CheckboxProps>((props, ref) => {
  const [attributes, { className, children, ...rest }] = splitProps(
    checkboxProps,
    checkboxGroupItemProps.useGroupProps(props),
  );
  return (
    <BaseCheckbox.Root
      ref={ref}
      {...rest}
      {...attributes}
      className={partClassName("checkbox", className)}
    >
      {children === undefined ? (
        <CheckboxIndicator
          render={(indicatorProps, state) => (
            <span {...indicatorProps}>
              {state.indeterminate ? <IconMinus /> : <IconCheck />}
            </span>
          )}
        />
      ) : (
        children
      )}
    </BaseCheckbox.Root>
  );
});
Checkbox.displayName = "Checkbox";

export { Checkbox, CheckboxIndicator };
