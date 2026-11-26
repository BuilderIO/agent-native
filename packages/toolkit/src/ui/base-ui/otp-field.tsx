import {
  type OtpFieldOwnProps,
  otpFieldProps,
} from "@agent-native/design-system";
import { OTPField as BaseOTPField } from "@base-ui/react/otp-field";
import * as React from "react";

import { partClassName } from "./part-class.js";
import { splitProps } from "./props.js";

export interface OTPFieldProps
  extends Omit<BaseOTPField.Root.Props, "color">, OtpFieldOwnProps {
  /** The accessible name of each box after the first, by its 1-based position. */
  inputLabel?: (position: number, length: number) => string;
}

const characterLabel = (position: number, length: number) =>
  `Character ${position} of ${length}`;

/**
 * A field for a one-time code with a box per character, on Base UI's OTP
 * Field. Typing moves to the next box and a pasted code fills them all; pass
 * OTPFieldInputs and an OTPFieldSeparator to group the boxes.
 *
 * @import import { OTPField, OTPFieldInput, OTPFieldSeparator } from "@agent-native/toolkit/ui/base-ui/otp-field";
 */
const OTPField = React.forwardRef<HTMLDivElement, OTPFieldProps>(
  (props, ref) => {
    const [
      attributes,
      { className, children, inputLabel = characterLabel, ...rest },
    ] = splitProps(otpFieldProps, props);
    return (
      <BaseOTPField.Root
        ref={ref}
        {...rest}
        {...attributes}
        className={partClassName("otp-field", className)}
      >
        {children ??
          Array.from({ length: rest.length }, (_, index) => (
            <OTPFieldInput
              key={index}
              {...(index === 0
                ? {}
                : { "aria-label": inputLabel(index + 1, rest.length) })}
            />
          ))}
      </BaseOTPField.Root>
    );
  },
);
OTPField.displayName = "OTPField";

export type OTPFieldInputProps = BaseOTPField.Input.Props;

/**
 * One character's box.
 *
 * @import import { OTPFieldInput } from "@agent-native/toolkit/ui/base-ui/otp-field";
 */
const OTPFieldInput = React.forwardRef<HTMLInputElement, OTPFieldInputProps>(
  ({ className, ...props }, ref) => (
    <BaseOTPField.Input
      ref={ref}
      {...props}
      className={partClassName("otp-field-input", className)}
    />
  ),
);
OTPFieldInput.displayName = "OTPFieldInput";

export type OTPFieldSeparatorProps = BaseOTPField.Separator.Props;

/**
 * A dash between groups of boxes, announced as a separator.
 *
 * @import import { OTPFieldSeparator } from "@agent-native/toolkit/ui/base-ui/otp-field";
 */
const OTPFieldSeparator = React.forwardRef<
  HTMLDivElement,
  OTPFieldSeparatorProps
>(({ className, ...props }, ref) => (
  <BaseOTPField.Separator
    ref={ref}
    {...props}
    className={partClassName("otp-field-separator", className)}
  />
));
OTPFieldSeparator.displayName = "OTPFieldSeparator";

export { OTPField, OTPFieldInput, OTPFieldSeparator };
