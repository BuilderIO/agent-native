import {
  type RadioGroupOwnProps,
  radioGroupProps,
} from "@agent-native/design-system";
import { Radio as BaseRadio } from "@base-ui/react/radio";
import { RadioGroup as BaseRadioGroup } from "@base-ui/react/radio-group";
import * as React from "react";

import { createGroupProps } from "./group-props.js";
import { partClassName } from "./part-class.js";
import { splitProps } from "./props.js";

export interface RadioGroupProps
  extends Omit<BaseRadioGroup.Props, "color">, RadioGroupOwnProps {}

const radioProps = createGroupProps(radioGroupProps);

/**
 * A set of options of which the user picks one, on Base UI's Radio Group with
 * Radix Themes' props. Every Radio inside it draws with the group's size and
 * color.
 *
 * @import import { RadioGroup, Radio } from "@agent-native/toolkit/ui/base-ui/radio-group";
 */
const RadioGroup = React.forwardRef<HTMLDivElement, RadioGroupProps>(
  (props, ref) => {
    const [attributes, { className, ...rest }] = splitProps(
      radioGroupProps,
      props,
    );
    return (
      <radioProps.GroupProps value={props}>
        <BaseRadioGroup
          ref={ref}
          {...rest}
          {...attributes}
          className={partClassName("radio-group", className)}
        />
      </radioProps.GroupProps>
    );
  },
);
RadioGroup.displayName = "RadioGroup";

export type RadioIndicatorProps = BaseRadio.Indicator.Props;

const RadioIndicator = React.forwardRef<HTMLSpanElement, RadioIndicatorProps>(
  ({ className, ...props }, ref) => (
    <BaseRadio.Indicator
      {...props}
      ref={ref}
      className={partClassName("radio-group-indicator", className)}
    />
  ),
);
RadioIndicator.displayName = "RadioIndicator";

export interface RadioProps
  extends Omit<BaseRadio.Root.Props, "color">, RadioGroupOwnProps {}

/**
 * One option in a RadioGroup, paired with a label. Wrap the two in a Field to
 * name it.
 *
 * @import import { Radio } from "@agent-native/toolkit/ui/base-ui/radio-group";
 */
const Radio = React.forwardRef<HTMLElement, RadioProps>((props, ref) => {
  const [attributes, { className, children, ...rest }] = splitProps(
    radioGroupProps,
    radioProps.useGroupProps(props),
  );
  return (
    <BaseRadio.Root
      ref={ref}
      {...rest}
      {...attributes}
      className={partClassName("radio-group-radio", className)}
    >
      {children === undefined ? <RadioIndicator /> : children}
    </BaseRadio.Root>
  );
});
Radio.displayName = "Radio";

export { RadioGroup, Radio, RadioIndicator };
