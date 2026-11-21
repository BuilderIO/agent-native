import {
  type SegmentedControlOwnProps,
  segmentedControlProps,
} from "@agent-native/design-system";
import { Toggle as BaseToggle } from "@base-ui/react/toggle";
import { ToggleGroup as BaseToggleGroup } from "@base-ui/react/toggle-group";
import * as React from "react";

import { partClassName } from "./part-class.js";
import { splitProps } from "./props.js";

export interface SegmentedControlProps
  extends
    Omit<
      BaseToggleGroup.Props<string>,
      "value" | "defaultValue" | "onValueChange" | "multiple"
    >,
    SegmentedControlOwnProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (
    value: string,
    eventDetails: BaseToggleGroup.ChangeEventDetails,
  ) => void;
}

/**
 * One choice among a few options in a single track, as Radix Themes'
 * SegmentedControl, built on Base UI's single-select Toggle Group. A choice
 * can't be cleared; to switch between panels of content, use Tabs.
 *
 * @import import { SegmentedControl, SegmentedControlItem } from "@agent-native/toolkit/ui/base-ui/segmented-control";
 */
const SegmentedControl = React.forwardRef<
  HTMLDivElement,
  SegmentedControlProps
>((props, ref) => {
  const [
    attributes,
    { className, value, defaultValue, onValueChange, ...rest },
  ] = splitProps(segmentedControlProps, props);
  return (
    <BaseToggleGroup
      ref={ref}
      {...rest}
      {...attributes}
      {...(value === undefined ? {} : { value: [value] })}
      {...(defaultValue === undefined ? {} : { defaultValue: [defaultValue] })}
      onValueChange={(next, eventDetails) => {
        const selected = next.at(0);
        if (selected === undefined) {
          eventDetails.cancel();
          return;
        }
        onValueChange?.(selected, eventDetails);
      }}
      className={partClassName("segmented-control", className)}
    />
  );
});
SegmentedControl.displayName = "SegmentedControl";

export interface SegmentedControlItemProps extends Omit<
  BaseToggle.Props<string>,
  "value" | "pressed" | "defaultPressed" | "onPressedChange"
> {
  value: string;
}

/**
 * One option in the track, a Base UI Toggle that is pressed while selected.
 *
 * @import import { SegmentedControlItem } from "@agent-native/toolkit/ui/base-ui/segmented-control";
 */
const SegmentedControlItem = React.forwardRef<
  HTMLButtonElement,
  SegmentedControlItemProps
>(({ className, ...props }, ref) => (
  <BaseToggle
    ref={ref}
    className={partClassName("segmented-control-item", className)}
    {...props}
  />
));
SegmentedControlItem.displayName = "SegmentedControlItem";

export { SegmentedControl, SegmentedControlItem };
