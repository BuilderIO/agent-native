import {
  type ControlSize,
  type NumberFieldOwnProps,
  numberFieldProps,
} from "@agent-native/design-system";
import { NumberField as BaseNumberField } from "@base-ui/react/number-field";
import {
  IconArrowsHorizontal,
  IconArrowsVertical,
  IconMinus,
  IconPlus,
} from "@tabler/icons-react";
import * as React from "react";
import { flushSync } from "react-dom";

import { cn } from "../../utils.js";
import { IconButton } from "./button.js";
import { observeFieldsetDisabled } from "./observe-fieldset-disabled.js";
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

interface NumberFieldContextValue {
  inputId: string;
  scrubControl: React.RefObject<HTMLElement | null>;
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
    const { onValueChange, onValueCommitted } = root;
    const generatedId = React.useId();
    const inputId = root.id ?? generatedId;
    const scrubControl = React.useRef<HTMLElement | null>(null);
    const context = React.useMemo<NumberFieldContextValue>(
      () => ({
        inputId,
        scrubControl,
        size: props.size ?? "md",
        variant: props.variant ?? "surface",
      }),
      [inputId, props.size, props.variant],
    );
    return (
      <NumberFieldContext.Provider value={context}>
        <BaseNumberField.Root
          {...root}
          onValueCommitted={
            onValueCommitted &&
            ((value, details) => {
              const input = scrubControl.current;
              if (
                details.event.type === "focusout" &&
                input === details.event.target &&
                input?.matches(":disabled, [readonly]")
              )
                return;
              onValueCommitted(value, details);
            })
          }
          onValueChange={
            root.value !== undefined && onValueChange
              ? (value, details) => {
                  if (details.reason === "scrub")
                    flushSync(() => onValueChange(value, details));
                  else onValueChange(value, details);
                }
              : onValueChange
          }
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
  /** Discard the preview if the field becomes unavailable or the pointer gesture is interrupted. */
  onScrubCancel?: () => void;
  /** The label to drag: text, or an icon beside visually hidden text. */
  children?: React.ReactNode;
}

/**
 * A label at the start of the field that changes the value when dragged
 * horizontally or vertically. It labels the input, and its cursor
 * stands in for the pointer while dragging.
 *
 * @import import { NumberFieldScrubArea } from "@agent-native/toolkit/ui/base-ui/number-field";
 */
const NumberFieldScrubArea = React.forwardRef<
  HTMLSpanElement,
  NumberFieldScrubAreaProps
>(
  (
    {
      className,
      children,
      direction = "horizontal",
      onPointerDownCapture,
      onScrubCancel,
      ...props
    },
    ref,
  ) => {
    const [revision, resetHandle] = React.useReducer((n: number) => n + 1, 0);
    const { inputId, scrubControl } = useNumberFieldContext(
      "NumberFieldScrubArea",
    );
    const gesture = React.useRef<AbortController | null>(null);
    const activeHandle = React.useRef<HTMLSpanElement | null>(null);
    const themeCursor = React.useCallback((cursor: HTMLSpanElement | null) => {
      const handle = activeHandle.current;
      if (!cursor || !handle) return;
      const style = handle.ownerDocument.defaultView?.getComputedStyle(handle);
      if (!style) return;
      for (const token of [
        "--fg-default",
        "--control-icon-size-3",
        "--shadow-tint-a7",
        "--layer-cursor",
      ]) {
        cursor.style.setProperty(token, style.getPropertyValue(token));
      }
    }, []);
    React.useEffect(() => () => gesture.current?.abort(), []);
    const trackPointer: NonNullable<
      NumberFieldScrubAreaProps["onPointerDownCapture"]
    > = (event) => {
      onPointerDownCapture?.(event);
      const control = event.currentTarget.querySelector("label")?.control;
      if (
        control?.matches(":disabled, [readonly]") ||
        (event.pointerType === "touch" && !event.isPrimary)
      ) {
        event.preventDefault();
        return;
      }
      if (
        event.defaultPrevented ||
        event.baseUIHandlerPrevented ||
        event.button !== 0 ||
        event.currentTarget.hasAttribute("data-disabled") ||
        event.currentTarget.hasAttribute("data-readonly")
      )
        return;
      const doc = event.currentTarget.ownerDocument;
      const win = doc.defaultView;
      if (!win) return;
      gesture.current?.abort();
      const controller = new win.AbortController();
      gesture.current = controller;
      activeHandle.current = event.currentTarget;
      const options = { capture: true, signal: controller.signal };
      const pointerId = event.pointerId;
      const cancel = () => {
        controller.abort();
        flushSync(() => {
          resetHandle();
          onScrubCancel?.();
        });
      };
      if (control) {
        scrubControl.current = control;
        const observer = new win.MutationObserver(() => {
          if (control.matches(":disabled, [readonly]")) cancel();
        });
        observer.observe(control, {
          attributeFilter: ["disabled", "readonly"],
        });
        observeFieldsetDisabled(control, observer);
        controller.signal.addEventListener(
          "abort",
          () => {
            observer.disconnect();
            scrubControl.current = null;
          },
          { once: true },
        );
      }
      const cancelOtherPointer = (other: PointerEvent) => {
        if (other.pointerId !== pointerId) cancel();
      };
      win.addEventListener("pointerdown", cancelOtherPointer, options);
      let x = event.clientX,
        y = event.clientY;
      win.addEventListener(
        "pointermove",
        (move) => {
          if (move.pointerId !== pointerId) {
            cancel();
            return;
          }
          if (!doc.pointerLockElement) {
            if (!move.movementX && move.clientX !== x)
              Object.defineProperty(move, "movementX", {
                value: move.clientX - x,
                configurable: true,
              });
            if (!move.movementY && move.clientY !== y)
              Object.defineProperty(move, "movementY", {
                value: move.clientY - y,
                configurable: true,
              });
          }
          x = move.clientX;
          y = move.clientY;
        },
        options,
      );
      const end = (release: PointerEvent) => {
        if (release.pointerId === pointerId) controller.abort();
        else cancel();
      };
      win.addEventListener("pointerup", end, options);
      win.addEventListener(
        "pointercancel",
        (event) => {
          if (event.pointerId === pointerId) cancel();
        },
        options,
      );
      win.addEventListener("blur", cancel, {
        signal: controller.signal,
      });
    };
    return (
      <BaseNumberField.ScrubArea
        key={revision}
        ref={ref}
        data-side="left"
        data-orientation={direction}
        direction={direction}
        {...props}
        onPointerDownCapture={trackPointer}
        className={partClassName(
          "input-slot number-field-scrub-area",
          className,
        )}
      >
        <label htmlFor={inputId}>{children}</label>
        <BaseNumberField.ScrubAreaCursor
          ref={themeCursor}
          className="number-field-scrub-area-cursor"
        >
          {direction === "vertical" ? (
            <IconArrowsVertical aria-hidden />
          ) : (
            <IconArrowsHorizontal aria-hidden />
          )}
        </BaseNumberField.ScrubAreaCursor>
      </BaseNumberField.ScrubArea>
    );
  },
);
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
  >(({ className, children, render, ...props }, ref) => {
    const { variant } = useNumberFieldContext(displayName);
    return (
      <Base
        ref={ref}
        render={
          render ?? (
            <IconButton
              size="sm"
              variant="ghost"
              {...(variant === "surface" ? { color: "gray" as const } : {})}
            />
          )
        }
        {...props}
        className={partClassName(part, className)}
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
