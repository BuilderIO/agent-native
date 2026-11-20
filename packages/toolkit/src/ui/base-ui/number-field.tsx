import {
  type ControlSize,
  type NumberFieldOwnProps,
  numberFieldProps,
} from "@agent-native/design-system";
import { NumberField as BaseNumberField } from "@base-ui/react/number-field";
import { IconArrowsHorizontal, IconMinus, IconPlus } from "@tabler/icons-react";
import * as React from "react";

import { cn } from "../../utils.js";
import { IconButton } from "./button.js";
import { partClassName } from "./part-class.js";
import { splitProps } from "./props.js";

const ROOT_PROPS = [
  "name",
  "defaultValue",
  "value",
  "onValueChange",
  "onValueCommitted",
  "allowOutOfRange",
  "form",
  "locale",
  "snapOnStep",
  "step",
  "smallStep",
  "largeStep",
  "min",
  "max",
  "allowWheelScrub",
  "format",
  "disabled",
  "readOnly",
  "required",
  "inputRef",
  "id",
] as const satisfies readonly (keyof BaseNumberField.Root.Props)[];

type RootProps = Pick<BaseNumberField.Root.Props, (typeof ROOT_PROPS)[number]>;

type InputProps = Omit<
  BaseNumberField.Input.Props,
  keyof RootProps | "className" | "style" | "size" | "color" | "children"
>;

export interface NumberFieldProps
  extends RootProps, InputProps, NumberFieldOwnProps {
  className?: string;
  style?: React.CSSProperties;
  /** A scrub area, `InputSlot`s and the steppers. */
  children?: React.ReactNode;
}

const ROOT_PROP_NAMES = new Set<string>(ROOT_PROPS);

const STEPPER_SIZE: Record<ControlSize, ControlSize> = {
  "1": "1",
  "2": "1",
  "3": "1",
  "4": "2",
};

interface NumberFieldContextValue {
  inputId: string;
  size: ControlSize;
  variant: "surface" | "soft";
}

const NumberFieldContext = React.createContext<NumberFieldContextValue | null>(
  null,
);

function useNumberFieldContext(part: string): NumberFieldContextValue {
  const context = React.useContext(NumberFieldContext);
  if (context === null) {
    throw new Error(`${part} must be placed inside a NumberField.`);
  }
  return context;
}

/**
 * A field for a number, typed, stepped or dragged, on Base UI's Number Field,
 * drawn as an Input is. A scrub area, unit slots and steppers go inside its
 * edge.
 *
 * @import import { NumberField, NumberFieldScrubArea, NumberFieldDecrement, NumberFieldIncrement } from "@agent-native/toolkit/ui/base-ui/number-field";
 */
const NumberField = React.forwardRef<HTMLInputElement, NumberFieldProps>(
  (props, ref) => {
    const [attributes, { className, style, children, ...rest }] = splitProps(
      numberFieldProps,
      props,
    );
    const rootEntries: Record<string, unknown> = {};
    const inputEntries: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(rest)) {
      if (ROOT_PROP_NAMES.has(name)) rootEntries[name] = value;
      else inputEntries[name] = value;
    }
    const root = rootEntries as RootProps;
    const generatedId = React.useId();
    const inputId = root.id ?? generatedId;
    const context = React.useMemo<NumberFieldContextValue>(
      () => ({
        inputId,
        size: props.size ?? "3",
        variant: props.variant ?? "surface",
      }),
      [inputId, props.size, props.variant],
    );
    return (
      <NumberFieldContext.Provider value={context}>
        <BaseNumberField.Root
          {...root}
          {...attributes}
          id={inputId}
          className={cn("input number-field", className)}
          style={style}
        >
          <BaseNumberField.Input
            ref={ref}
            className="input-control"
            {...(inputEntries as InputProps)}
          />
          {children}
        </BaseNumberField.Root>
      </NumberFieldContext.Provider>
    );
  },
);
NumberField.displayName = "NumberField";

export interface NumberFieldScrubAreaProps extends Omit<
  BaseNumberField.ScrubArea.Props,
  "children"
> {
  /** The label to drag: text, or an icon beside visually hidden text. */
  children?: React.ReactNode;
}

/**
 * A label at the start of the field that changes the value when dragged
 * sideways, a step per two pixels. It labels the input, and its cursor
 * stands in for the pointer while dragging.
 *
 * @import import { NumberFieldScrubArea } from "@agent-native/toolkit/ui/base-ui/number-field";
 */
const NumberFieldScrubArea = React.forwardRef<
  HTMLSpanElement,
  NumberFieldScrubAreaProps
>(({ className, children, ...props }, ref) => {
  const { inputId } = useNumberFieldContext("NumberFieldScrubArea");
  return (
    <BaseNumberField.ScrubArea
      ref={ref}
      data-side="left"
      {...props}
      className={partClassName("input-slot number-field-scrub-area", className)}
    >
      <label htmlFor={inputId}>{children}</label>
      <BaseNumberField.ScrubAreaCursor className="number-field-scrub-area-cursor">
        <IconArrowsHorizontal aria-hidden />
      </BaseNumberField.ScrubAreaCursor>
    </BaseNumberField.ScrubArea>
  );
});
NumberFieldScrubArea.displayName = "NumberFieldScrubArea";

export type NumberFieldStepperProps = BaseNumberField.Increment.Props;

function createStepper(
  part: "number-field-decrement" | "number-field-increment",
  displayName: string,
  Base: typeof BaseNumberField.Increment | typeof BaseNumberField.Decrement,
  icon: React.ReactNode,
) {
  const component = React.forwardRef<
    HTMLButtonElement,
    NumberFieldStepperProps
  >(({ className, children, ...props }, ref) => {
    const { size, variant } = useNumberFieldContext(displayName);
    return (
      <Base
        ref={ref}
        {...props}
        className={partClassName(part, className)}
        render={
          <IconButton
            size={STEPPER_SIZE[size]}
            variant="ghost"
            {...(variant === "surface" ? { color: "gray" as const } : {})}
          />
        }
      >
        {children ?? icon}
      </Base>
    );
  });
  component.displayName = displayName;
  return component;
}

/**
 * The button that lowers the value a step. Base UI names it "Decrease".
 *
 * @import import { NumberFieldDecrement } from "@agent-native/toolkit/ui/base-ui/number-field";
 */
const NumberFieldDecrement = createStepper(
  "number-field-decrement",
  "NumberFieldDecrement",
  BaseNumberField.Decrement,
  <IconMinus aria-hidden />,
);

/**
 * The button that raises the value a step. Base UI names it "Increase".
 *
 * @import import { NumberFieldIncrement } from "@agent-native/toolkit/ui/base-ui/number-field";
 */
const NumberFieldIncrement = createStepper(
  "number-field-increment",
  "NumberFieldIncrement",
  BaseNumberField.Increment,
  <IconPlus aria-hidden />,
);

export {
  NumberField,
  NumberFieldScrubArea,
  NumberFieldDecrement,
  NumberFieldIncrement,
};
