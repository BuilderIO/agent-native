import {
  type ToggleGroupOwnProps,
  toggleGroupProps,
} from "@agent-native/design-system";
import { ToggleGroup as BaseToggleGroup } from "@base-ui/react/toggle-group";
import * as React from "react";

import { createGroupProps } from "./group-props.js";
import { partClassName } from "./part-class.js";
import { splitProps } from "./props.js";

export interface ToggleGroupProps
  extends Omit<BaseToggleGroup.Props, "color">, ToggleGroupOwnProps {}

const toggleGroupItemProps = createGroupProps(toggleGroupProps);

/**
 * A row or column of Toggles for one or several choices, on Base UI's Toggle
 * Group. Its size, variant and color are the defaults of every Toggle inside
 * it, as Radix Themes' groups pass props to their items.
 *
 * @import import { ToggleGroup } from "@agent-native/toolkit/ui/base-ui/toggle-group";
 */
const ToggleGroup = React.forwardRef<HTMLDivElement, ToggleGroupProps>(
  (props, ref) => {
    const [attributes, { className, ...rest }] = splitProps(
      toggleGroupProps,
      props,
    );
    return (
      <toggleGroupItemProps.GroupProps value={props}>
        <BaseToggleGroup
          ref={ref}
          {...rest}
          {...attributes}
          className={partClassName("toggle-group", className)}
        />
      </toggleGroupItemProps.GroupProps>
    );
  },
);
ToggleGroup.displayName = "ToggleGroup";

export { ToggleGroup, toggleGroupItemProps };
