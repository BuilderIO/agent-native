import { Form as BaseForm } from "@base-ui/react/form";
import * as React from "react";

import { partClassName } from "./part-class.js";

export type FormProps = BaseForm.Props;

/**
 * A form that stacks its fields a step apart and validates them, on Base UI's
 * Form. Errors from a server show through each Field's FieldError.
 *
 * @import import { Form } from "@agent-native/toolkit/ui/base-ui/form";
 */
const Form = React.forwardRef<HTMLFormElement, FormProps>(
  ({ className, ...props }, ref) => (
    <BaseForm
      ref={ref}
      {...props}
      className={partClassName("form", className)}
    />
  ),
);
Form.displayName = "Form";

export { Form };
