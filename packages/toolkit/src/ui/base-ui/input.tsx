import { type InputOwnProps, inputProps } from "@agent-native/design-system";
import { Input as BaseInput } from "@base-ui/react/input";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import * as React from "react";

import { cn } from "../../utils.js";
import { splitProps } from "./props.js";

export interface InputProps
  extends
    Omit<BaseInput.Props, "size" | "color" | "className" | "style">,
    InputOwnProps {
  className?: string;
  style?: React.CSSProperties;
  /** `InputSlot`s: an icon, a shortcut, a unit or a button. */
  children?: React.ReactNode;
}

// The types whose caret can be placed; the others throw on setSelectionRange.
const CARET_TYPES = new Set(["text", "search", "url", "tel", "password"]);

// The slots the CSS places after the text: the same rule as input.css.
const TRAILING_SLOT =
  ".input-slot[data-side=right], .input-slot:not([data-side=right]) ~ .input-slot:not([data-side=left])";

/**
 * A single-line text field: Base UI's Input in a frame, with Radix Themes'
 * TextField props. Icons, units and buttons go inside its edge as InputSlots;
 * inside a Field it takes the field's label and validation.
 *
 * @import import { Input, InputSlot } from "@agent-native/toolkit/ui/base-ui/input";
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>((props, ref) => {
  const [attributes, { className, style, children, ...rest }] = splitProps(
    inputProps,
    props,
  );
  return (
    <div
      {...attributes}
      className={cn("input", className)}
      style={style}
      onPointerDown={(event) => {
        // A press on a slot's icon or padding focuses the input, with the
        // caret at the end nearest the slot. Controls in a slot keep the press.
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (target.closest("input, button, a, [role=button]")) return;
        const input = event.currentTarget.querySelector("input");
        if (input === null) return;
        const caret =
          target.closest(TRAILING_SLOT) === null ? 0 : input.value.length;
        // After the press's own focus handling, which would blur the input.
        requestAnimationFrame(() => {
          if (CARET_TYPES.has(input.type)) {
            input.setSelectionRange(caret, caret);
          }
          input.focus();
        });
      }}
    >
      <BaseInput ref={ref} className="input-control" {...rest} />
      {children}
    </div>
  );
});
Input.displayName = "Input";

export interface InputSlotProps extends useRender.ComponentProps<"div"> {
  /**
   * Which end of the field the slot sits at. Unset, the first slot goes
   * before the text and a second one after it, as in Radix Themes.
   */
  side?: "left" | "right";
}

/**
 * Content inside an Input's edge, before or after the text: an icon, a
 * shortcut, a unit or a button.
 *
 * @import import { InputSlot } from "@agent-native/toolkit/ui/base-ui/input";
 */
function InputSlot({ render, side, ...props }: InputSlotProps) {
  const attributes: Record<string, string> =
    side === undefined ? {} : { "data-side": side };
  return useRender({
    defaultTagName: "div",
    render,
    props: mergeProps<"div">({ className: "input-slot", ...attributes }, props),
  });
}

export { Input, InputSlot };
