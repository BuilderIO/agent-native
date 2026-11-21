import { type SliderOwnProps, sliderProps } from "@agent-native/design-system";
import { Slider as BaseSlider } from "@base-ui/react/slider";
import * as React from "react";

import { partClassName } from "./part-class.js";
import { splitProps } from "./props.js";

export interface SliderProps
  extends Omit<BaseSlider.Root.Props, "color">, SliderOwnProps {
  /** Names each thumb for assistive technology, by its index. */
  thumbLabel?: string | ((index: number) => string);
}

function thumbCount(
  value: SliderProps["value"],
  defaultValue: SliderProps["defaultValue"],
): number {
  const current = value ?? defaultValue;
  return Array.isArray(current) ? current.length : 1;
}

/**
 * A track with one or more thumbs for picking a number or a range by dragging,
 * on Base UI's Slider with Radix Themes' props.
 *
 * @import import { Slider } from "@agent-native/toolkit/ui/base-ui/slider";
 */
const Slider = React.forwardRef<HTMLDivElement, SliderProps>((props, ref) => {
  const [attributes, { className, thumbLabel, ...rest }] = splitProps(
    sliderProps,
    props,
  );
  const thumbs = thumbCount(props.value, props.defaultValue);
  return (
    <BaseSlider.Root
      ref={ref}
      {...rest}
      {...attributes}
      className={partClassName("slider", className)}
    >
      <BaseSlider.Control className="slider-control">
        <BaseSlider.Track className="slider-track">
          <BaseSlider.Indicator className="slider-indicator" />
          {Array.from({ length: thumbs }, (_, index) => (
            <BaseSlider.Thumb
              key={index}
              index={index}
              aria-label={
                typeof thumbLabel === "function"
                  ? thumbLabel(index)
                  : thumbLabel
              }
              className="slider-thumb"
            />
          ))}
        </BaseSlider.Track>
      </BaseSlider.Control>
    </BaseSlider.Root>
  );
});
Slider.displayName = "Slider";

export { Slider };
