import {
  type TextAreaOwnProps,
  textAreaProps,
} from "@agent-native/design-system";
import { Field as BaseField } from "@base-ui/react/field";
import * as React from "react";

import { partClassName } from "./part-class.js";
import { splitProps } from "./props.js";

type ControlProps = BaseField.Control.Props;

export interface TextAreaProps
  extends
    Omit<
      React.TextareaHTMLAttributes<HTMLTextAreaElement>,
      "value" | "defaultValue" | "className" | "color"
    >,
    TextAreaOwnProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: ControlProps["onValueChange"];
  className?: ControlProps["className"];
}

/**
 * A text field for several lines, with Radix Themes' TextArea props. Base UI
 * has no textarea of its own, so it is Base UI's Field Control rendered as one;
 * inside a Field it takes the field's label, description and validation like an
 * Input.
 *
 * @import import { TextArea } from "@agent-native/toolkit/ui/base-ui/text-area";
 */
const TextArea = React.forwardRef<HTMLTextAreaElement, TextAreaProps>(
  (props, ref) => {
    const [
      attributes,
      {
        className,
        value,
        defaultValue,
        onValueChange,
        disabled,
        id,
        name,
        required,
        ...rest
      },
    ] = splitProps(textAreaProps, props);
    return (
      <BaseField.Control
        ref={ref as React.Ref<HTMLInputElement>}
        value={value}
        defaultValue={defaultValue}
        onValueChange={onValueChange}
        disabled={disabled}
        id={id}
        name={name}
        required={required}
        {...attributes}
        className={partClassName("text-area", className)}
        render={<textarea {...rest} />}
      />
    );
  },
);
TextArea.displayName = "TextArea";

export { TextArea };
