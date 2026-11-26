import { type SwitchOwnProps, switchProps } from "@agent-native/design-system";
import { Switch as BaseSwitch } from "@base-ui/react/switch";
import * as React from "react";

import { partClassName } from "./part-class.js";
import { splitProps } from "./props.js";

export type SwitchThumbProps = BaseSwitch.Thumb.Props;

const SwitchThumb = React.forwardRef<HTMLSpanElement, SwitchThumbProps>(
  ({ className, ...props }, ref) => (
    <BaseSwitch.Thumb
      {...props}
      ref={ref}
      className={partClassName("switch-thumb", className)}
    />
  ),
);
SwitchThumb.displayName = "SwitchThumb";

export interface SwitchProps
  extends Omit<BaseSwitch.Root.Props, "color">, SwitchOwnProps {}

/**
 * A toggle for a setting that takes effect at once, on Base UI's Switch with
 * Radix Themes' props. Pair it with a label in a Field.
 *
 * @import import { Switch } from "@agent-native/toolkit/ui/base-ui/switch";
 */
const Switch = React.forwardRef<HTMLElement, SwitchProps>((props, ref) => {
  const [attributes, { className, children, ...rest }] = splitProps(
    switchProps,
    props,
  );
  return (
    <BaseSwitch.Root
      ref={ref}
      {...rest}
      {...attributes}
      className={partClassName("switch", className)}
    >
      {children === undefined ? <SwitchThumb /> : children}
    </BaseSwitch.Root>
  );
});
Switch.displayName = "Switch";

export { Switch, SwitchThumb };
