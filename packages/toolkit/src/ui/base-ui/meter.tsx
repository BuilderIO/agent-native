import { type MeterOwnProps, meterProps } from "@agent-native/design-system";
import { Meter as BaseMeter } from "@base-ui/react/meter";
import * as React from "react";

import { partClassName } from "./part-class.js";
import { splitProps } from "./props.js";

export interface MeterProps
  extends Omit<BaseMeter.Root.Props, "color">, MeterOwnProps {}

/**
 * A level within a known range, such as storage used, on Base UI's Meter with
 * Radix Themes' Progress props. Use Progress for a task's progress instead.
 * A label and the value go in the children, above the track.
 *
 * @import import { Meter, MeterLabel, MeterValue } from "@agent-native/toolkit/ui/base-ui/meter";
 */
const Meter = React.forwardRef<HTMLDivElement, MeterProps>((props, ref) => {
  const [attributes, { className, children, ...rest }] = splitProps(
    meterProps,
    props,
  );
  return (
    <BaseMeter.Root
      ref={ref}
      {...rest}
      {...attributes}
      className={partClassName("meter", className)}
    >
      {children}
      <BaseMeter.Track className="meter-track">
        <BaseMeter.Indicator className="meter-indicator" />
      </BaseMeter.Track>
    </BaseMeter.Root>
  );
});
Meter.displayName = "Meter";

export type MeterLabelProps = BaseMeter.Label.Props;

/**
 * Names what the meter measures, above its track.
 *
 * @import import { MeterLabel } from "@agent-native/toolkit/ui/base-ui/meter";
 */
const MeterLabel = React.forwardRef<HTMLSpanElement, MeterLabelProps>(
  ({ className, ...props }, ref) => (
    <BaseMeter.Label
      ref={ref}
      className={partClassName("meter-label", className)}
      {...props}
    />
  ),
);
MeterLabel.displayName = "MeterLabel";

export type MeterValueProps = BaseMeter.Value.Props;

/**
 * The meter's value as text, formatted by the meter's `format`.
 *
 * @import import { MeterValue } from "@agent-native/toolkit/ui/base-ui/meter";
 */
const MeterValue = React.forwardRef<HTMLSpanElement, MeterValueProps>(
  ({ className, ...props }, ref) => (
    <BaseMeter.Value
      ref={ref}
      className={partClassName("meter-value", className)}
      {...props}
    />
  ),
);
MeterValue.displayName = "MeterValue";

export { Meter, MeterLabel, MeterValue };
