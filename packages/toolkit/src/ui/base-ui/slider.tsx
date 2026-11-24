import { type SliderOwnProps, sliderProps } from "@agent-native/design-system";
import { Slider as BaseSlider } from "@base-ui/react/slider";
import * as React from "react";

import { partClassName } from "./part-class.js";
import { splitProps } from "./props.js";

type SliderValue = number | readonly number[];

export interface SliderProps<Value extends SliderValue = SliderValue>
  extends Omit<BaseSlider.Root.Props<Value>, "color">, SliderOwnProps {
  /** Names the automatic thumbs by index. When composing SliderThumb, set its accessible name directly. */
  thumbLabel?: string | ((index: number) => string);
}

function thumbCount(
  value: SliderProps["value"],
  defaultValue: SliderProps["defaultValue"],
): number {
  const current = value ?? defaultValue;
  return Array.isArray(current) ? current.length : 1;
}

export const SliderControl = React.forwardRef<
  HTMLDivElement,
  BaseSlider.Control.Props
>(({ className, ...props }, ref) => (
  <BaseSlider.Control
    {...props}
    ref={ref}
    className={partClassName("slider-control", className)}
  />
));
SliderControl.displayName = "SliderControl";

export const SliderTrack = React.forwardRef<
  HTMLDivElement,
  BaseSlider.Track.Props
>(({ className, ...props }, ref) => (
  <BaseSlider.Track
    {...props}
    ref={ref}
    className={partClassName("slider-track", className)}
  />
));
SliderTrack.displayName = "SliderTrack";

export const SliderIndicator = React.forwardRef<
  HTMLDivElement,
  BaseSlider.Indicator.Props
>(({ className, ...props }, ref) => (
  <BaseSlider.Indicator
    {...props}
    ref={ref}
    className={partClassName("slider-indicator", className)}
  />
));
SliderIndicator.displayName = "SliderIndicator";

export const SliderThumb = React.forwardRef<
  HTMLDivElement,
  BaseSlider.Thumb.Props
>(({ className, ...props }, ref) => (
  <BaseSlider.Thumb
    {...props}
    ref={ref}
    className={partClassName("slider-thumb", className)}
  />
));
SliderThumb.displayName = "SliderThumb";

/**
 * A track with one or more thumbs for picking a number or a range by dragging,
 * on Base UI's Slider with Radix Themes' props.
 *
 * @import import { Slider } from "@agent-native/toolkit/ui/base-ui/slider";
 */
function Slider<Value extends SliderValue>({
  ref,
  ...props
}: SliderProps<Value> & { ref?: React.Ref<HTMLDivElement> }) {
  const [attributes, { className, children, thumbLabel, ...rest }] = splitProps(
    sliderProps,
    props,
  );
  const thumbs = thumbCount(props.value, props.defaultValue);
  return (
    <BaseSlider.Root<Value>
      ref={ref}
      {...rest}
      {...attributes}
      className={partClassName("slider", className)}
    >
      {children === undefined ? (
        <SliderControl>
          <SliderTrack>
            <SliderIndicator />
            {Array.from({ length: thumbs }, (_, index) => (
              <SliderThumb
                key={index}
                index={index}
                aria-label={
                  typeof thumbLabel === "function"
                    ? thumbLabel(index)
                    : thumbLabel
                }
              />
            ))}
          </SliderTrack>
        </SliderControl>
      ) : (
        children
      )}
    </BaseSlider.Root>
  );
}

export { Slider };
