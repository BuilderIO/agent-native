import {
  type SelectPopupOwnProps,
  selectPopupProps,
  type SelectRootOwnProps,
  selectRootProps,
  type SelectTriggerOwnProps,
  selectTriggerProps,
} from "@agent-native/design-system";
import { Select as BaseSelect } from "@base-ui/react/select";
import { IconCheck, IconChevronDown } from "@tabler/icons-react";
import * as React from "react";

import { cn } from "../../utils.js";
import { splitPositionerProps } from "./positioning.js";
import { splitProps } from "./props.js";

const SelectSizeContext = React.createContext<string | undefined>(undefined);

export type SelectProps<
  Value,
  Multiple extends boolean | undefined = false,
> = BaseSelect.Root.Props<Value, Multiple> & SelectRootOwnProps;

/**
 * A button that opens a list of options to pick one from, on Base UI's Select
 * with Radix Themes' props. Pass `items` so SelectValue shows the selected
 * item's label rather than its value.
 *
 * @import import { Select, SelectTrigger, SelectValue, SelectPopup, SelectItem } from "@agent-native/toolkit/ui/base-ui/select";
 */
function Select<Value, Multiple extends boolean | undefined = false>(
  props: SelectProps<Value, Multiple>,
) {
  const [attributes, rest] = splitProps(selectRootProps, props);
  return (
    <SelectSizeContext.Provider value={attributes["data-size"]}>
      <BaseSelect.Root<Value, Multiple> {...rest} />
    </SelectSizeContext.Provider>
  );
}

/**
 * Groups related options, labelled by a SelectGroupLabel inside it. It is Base UI's
 * own part.
 *
 * @import import { SelectGroup } from "@agent-native/toolkit/ui/base-ui/select";
 */
export const SelectGroup = BaseSelect.Group;

/**
 * The selected option's label, shown in the trigger, or a placeholder while
 * nothing is selected.
 *
 * @import import { SelectValue } from "@agent-native/toolkit/ui/base-ui/select";
 */
const SelectValue = React.forwardRef<
  HTMLSpanElement,
  Omit<BaseSelect.Value.Props, "className"> & { className?: string }
>(({ className, ...props }, ref) => (
  <BaseSelect.Value
    ref={ref}
    className={cn("select-value", className)}
    {...props}
  />
));
SelectValue.displayName = "SelectValue";

export interface SelectTriggerProps
  extends
    Omit<BaseSelect.Trigger.Props, "className" | "color">,
    SelectTriggerOwnProps {
  className?: string;
}

/**
 * The button that shows the selected value and opens the list, with a chevron
 * after it.
 *
 * @import import { SelectTrigger } from "@agent-native/toolkit/ui/base-ui/select";
 */
const SelectTrigger = React.forwardRef<HTMLButtonElement, SelectTriggerProps>(
  (props, ref) => {
    const [attributes, { className, children, ...rest }] = splitProps(
      selectTriggerProps,
      props,
    );
    const size = React.useContext(SelectSizeContext);
    return (
      <BaseSelect.Trigger
        ref={ref}
        data-slot="select-trigger"
        {...rest}
        {...attributes}
        data-size={size}
        className={cn("select-trigger", className)}
      >
        {children}
        <BaseSelect.Icon className="select-icon">
          <IconChevronDown />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
    );
  },
);
SelectTrigger.displayName = "SelectTrigger";

type PositionerProps = Pick<
  BaseSelect.Positioner.Props,
  | "anchor"
  | "side"
  | "align"
  | "sideOffset"
  | "alignOffset"
  | "collisionBoundary"
  | "collisionPadding"
  | "collisionAvoidance"
  | "sticky"
  | "arrowPadding"
  | "disableAnchorTracking"
  | "positionMethod"
  | "alignItemWithTrigger"
>;

export type SelectPopupProps = Omit<
  BaseSelect.Popup.Props,
  "className" | "color"
> &
  PositionerProps &
  SelectPopupOwnProps & {
    className?: string;
    container?: BaseSelect.Portal.Props["container"];
  };

/**
 * The list's popup, anchored below the trigger; it can overlap the trigger like
 * a native menu instead.
 *
 * @import import { SelectPopup } from "@agent-native/toolkit/ui/base-ui/select";
 */
const SelectPopup = React.forwardRef<HTMLDivElement, SelectPopupProps>(
  (props, ref) => {
    const [
      attributes,
      { className, children, container, alignItemWithTrigger = false, ...rest },
    ] = splitProps(selectPopupProps, props);
    const [positioner, popup] = splitPositionerProps(rest);
    const size = React.useContext(SelectSizeContext);
    return (
      <BaseSelect.Portal container={container}>
        <BaseSelect.Positioner
          className="select-positioner"
          align="start"
          sideOffset={4}
          alignItemWithTrigger={alignItemWithTrigger}
          {...positioner}
        >
          <BaseSelect.Popup
            ref={ref}
            data-slot="select-content"
            {...popup}
            {...attributes}
            data-size={size}
            className={cn("select-popup", className)}
          >
            <BaseSelect.List className="select-list">
              {children}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    );
  },
);
SelectPopup.displayName = "SelectPopup";

/**
 * The heading of a SelectGroup.
 *
 * @import import { SelectGroupLabel } from "@agent-native/toolkit/ui/base-ui/select";
 */
const SelectGroupLabel = React.forwardRef<
  HTMLDivElement,
  Omit<BaseSelect.GroupLabel.Props, "className"> & { className?: string }
>(({ className, ...props }, ref) => (
  <BaseSelect.GroupLabel
    ref={ref}
    className={cn("select-group-label", className)}
    {...props}
  />
));
SelectGroupLabel.displayName = "SelectGroupLabel";

/**
 * One option in the list, with a check beside it while selected.
 *
 * @import import { SelectItem } from "@agent-native/toolkit/ui/base-ui/select";
 */
const SelectItem = React.forwardRef<
  HTMLDivElement,
  Omit<BaseSelect.Item.Props, "className"> & { className?: string }
>(({ className, children, ...props }, ref) => (
  <BaseSelect.Item
    ref={ref}
    className={cn("select-item", className)}
    {...props}
  >
    <BaseSelect.ItemIndicator className="select-item-indicator">
      <IconCheck />
    </BaseSelect.ItemIndicator>
    <BaseSelect.ItemText className="select-item-text">
      {children}
    </BaseSelect.ItemText>
  </BaseSelect.Item>
));
SelectItem.displayName = "SelectItem";

/**
 * A line between groups of options.
 *
 * @import import { SelectSeparator } from "@agent-native/toolkit/ui/base-ui/select";
 */
const SelectSeparator = React.forwardRef<
  HTMLDivElement,
  Omit<BaseSelect.Separator.Props, "className"> & { className?: string }
>(({ className, ...props }, ref) => (
  <BaseSelect.Separator
    ref={ref}
    className={cn("select-separator", className)}
    {...props}
  />
));
SelectSeparator.displayName = "SelectSeparator";

export {
  Select,
  SelectPopup,
  SelectItem,
  SelectGroupLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
