import { Field as BaseField } from "@base-ui/react/field";
import * as React from "react";

import { partClassName } from "./part-class.js";

export type FieldProps = BaseField.Root.Props;

/**
 * Ties a label, description and error to the control inside it and runs its
 * validation, on Base UI's Field. Wrap every form control in one.
 *
 * @import import { Field, FieldLabel, FieldDescription, FieldError } from "@agent-native/toolkit/ui/base-ui/field";
 */
const Field = React.forwardRef<HTMLDivElement, FieldProps>(
  ({ className, ...props }, ref) => (
    <BaseField.Root
      ref={ref}
      className={partClassName("field", className)}
      {...props}
    />
  ),
);
Field.displayName = "Field";

export type FieldLabelProps = BaseField.Label.Props;

/**
 * A field's label. Inside a Field it names the control and follows its state.
 *
 * @import import { FieldLabel } from "@agent-native/toolkit/ui/base-ui/field";
 */
const FieldLabel = React.forwardRef<HTMLLabelElement, FieldLabelProps>(
  ({ className, ...props }, ref) => (
    <BaseField.Label
      ref={ref}
      className={partClassName("field-label", className)}
      {...props}
    />
  ),
);
FieldLabel.displayName = "FieldLabel";

export type FieldDescriptionProps = BaseField.Description.Props;

/**
 * A hint under the control that the control is described by.
 *
 * @import import { FieldDescription } from "@agent-native/toolkit/ui/base-ui/field";
 */
const FieldDescription = React.forwardRef<
  HTMLParagraphElement,
  FieldDescriptionProps
>(({ className, ...props }, ref) => (
  <BaseField.Description
    ref={ref}
    className={partClassName("field-description", className)}
    {...props}
  />
));
FieldDescription.displayName = "FieldDescription";

export type FieldErrorProps = BaseField.Error.Props;

/**
 * The message shown while the field is invalid. `match` picks which validity
 * it explains.
 *
 * @import import { FieldError } from "@agent-native/toolkit/ui/base-ui/field";
 */
const FieldError = React.forwardRef<HTMLDivElement, FieldErrorProps>(
  ({ className, ...props }, ref) => (
    <BaseField.Error
      ref={ref}
      className={partClassName("field-error", className)}
      {...props}
    />
  ),
);
FieldError.displayName = "FieldError";

export { Field, FieldLabel, FieldDescription, FieldError };
