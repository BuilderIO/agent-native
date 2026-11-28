import * as SliderPrimitive from "@radix-ui/react-slider";
import * as React from "react";

import { cn } from "@/lib/utils";

interface ActiveSliderDrag {
  pointerId: number;
  latestValues: number[];
  changed: boolean;
  committed: boolean;
  canceled: boolean;
}

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & {
    thumbAriaLabel?: string;
  }
>(
  (
    {
      className,
      thumbAriaLabel,
      "aria-label": ariaLabel,
      onValueChange,
      onValueCommit,
      onPointerDown,
      onPointerUp,
      onPointerCancel,
      onLostPointerCapture,
      onKeyDown,
      ...props
    },
    ref,
  ) => {
    const activeDragRef = React.useRef<ActiveSliderDrag | null>(null);
    const currentValues = props.value ?? props.defaultValue ?? [props.min ?? 0];
    const resolvedThumbAriaLabel = thumbAriaLabel ?? ariaLabel;

    const commitLostDrag = (pointerId: number) => {
      const drag = activeDragRef.current;
      if (!drag || drag.pointerId !== pointerId) return;
      if (drag.changed && !drag.committed && !drag.canceled) {
        drag.committed = true;
        onValueCommit?.(drag.latestValues);
      }
    };

    return (
      <SliderPrimitive.Root
        ref={ref}
        {...props}
        className={cn(
          "relative flex w-full touch-none select-none items-center",
          className,
        )}
        onPointerDown={(event) => {
          onPointerDown?.(event);
          if (event.defaultPrevented) return;
          if (props.disabled || event.button !== 0) {
            if (event.button !== 0) event.preventDefault();
            return;
          }
          activeDragRef.current = {
            pointerId: event.pointerId,
            latestValues: [...currentValues],
            changed: false,
            committed: false,
            canceled: false,
          };
        }}
        onValueChange={(nextValues) => {
          if (activeDragRef.current) {
            activeDragRef.current.latestValues = nextValues;
            activeDragRef.current.changed = true;
          }
          onValueChange?.(nextValues);
        }}
        onValueCommit={(nextValues) => {
          if (activeDragRef.current) {
            if (
              activeDragRef.current.committed ||
              activeDragRef.current.canceled
            ) {
              return;
            }
            activeDragRef.current.committed = true;
          }
          onValueCommit?.(nextValues);
        }}
        onPointerUp={(event) => {
          onPointerUp?.(event);
          const target = event.target as Element | null;
          const hasCapture =
            typeof target?.hasPointerCapture === "function" &&
            target.hasPointerCapture(event.pointerId);
          if (!hasCapture) {
            commitLostDrag(event.pointerId);
          }
        }}
        onPointerCancel={(event) => {
          if (
            activeDragRef.current &&
            activeDragRef.current.pointerId === event.pointerId
          ) {
            activeDragRef.current.canceled = true;
          }
          onPointerCancel?.(event);
        }}
        onLostPointerCapture={(event) => {
          onLostPointerCapture?.(event);
          commitLostDrag(event.pointerId);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            if (activeDragRef.current) {
              activeDragRef.current.canceled = true;
            }
          } else {
            activeDragRef.current = null;
          }
          onKeyDown?.(event);
        }}
      >
        <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-secondary">
          <SliderPrimitive.Range className="absolute h-full bg-primary" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          {...(resolvedThumbAriaLabel !== undefined
            ? { "aria-label": resolvedThumbAriaLabel }
            : {})}
          className="block h-5 w-5 rounded-full border-2 border-primary bg-background ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
        />
      </SliderPrimitive.Root>
    );
  },
);
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
