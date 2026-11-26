import {
  type CheckboxGroupOwnProps,
  checkboxGroupProps,
} from "@agent-native/design-system";
import { CheckboxGroup as BaseCheckboxGroup } from "@base-ui/react/checkbox-group";
import * as React from "react";

import { createGroupProps } from "./group-props.js";
import { partClassName } from "./part-class.js";
import { splitProps } from "./props.js";

export interface CheckboxGroupProps
  extends Omit<BaseCheckboxGroup.Props, "color">, CheckboxGroupOwnProps {}

const checkboxGroupItemProps = createGroupProps(checkboxGroupProps);

/**
 * Holds the checked values of the checkboxes inside it, on Base UI's Checkbox
 * Group. Its size, variant and color are the defaults of every Checkbox inside
 * it, as in Radix Themes.
 *
 * @import import { CheckboxGroup } from "@agent-native/toolkit/ui/base-ui/checkbox-group";
 */
const CheckboxGroup = React.forwardRef<HTMLDivElement, CheckboxGroupProps>(
  (props, ref) => {
    const [attributes, { className, ...rest }] = splitProps(
      checkboxGroupProps,
      props,
    );
    return (
      <checkboxGroupItemProps.GroupProps value={props}>
        <BaseCheckboxGroup
          ref={ref}
          {...rest}
          {...attributes}
          className={partClassName("checkbox-group", className)}
        />
      </checkboxGroupItemProps.GroupProps>
    );
  },
);
CheckboxGroup.displayName = "CheckboxGroup";

export { CheckboxGroup, checkboxGroupItemProps };
