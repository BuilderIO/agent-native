import {
  type ButtonOwnProps,
  buttonProps,
  type ControlSize,
} from "@agent-native/design-system";
import { Button as BaseButton } from "@base-ui/react/button";
import * as React from "react";

import { partClassName } from "./part-class.js";
import { splitProps } from "./props.js";
import { Spinner, type SpinnerProps } from "./spinner.js";
import { VisuallyHidden } from "./visually-hidden.js";

export interface ButtonProps
  extends Omit<BaseButton.Props, "color">, ButtonOwnProps {}

export type IconButtonProps = ButtonProps;

const SPINNER_SIZE: Record<ControlSize, NonNullable<SpinnerProps["size"]>> = {
  "1": "1",
  "2": "1",
  "3": "2",
  "4": "3",
};

function createButton(part: "button" | "icon-button", displayName: string) {
  const component = React.forwardRef<HTMLButtonElement, ButtonProps>(
    (props, ref) => {
      const [attributes, { className, children, disabled, ...rest }] =
        splitProps(buttonProps, props);
      const loading = props.loading === true;
      return (
        <BaseButton
          ref={ref}
          {...rest}
          {...attributes}
          className={partClassName(part, className)}
          disabled={disabled ?? loading}
          aria-busy={loading || undefined}
        >
          {loading ? (
            <>
              <span className="button-content" aria-hidden>
                {children}
              </span>
              <VisuallyHidden>{children}</VisuallyHidden>
              <span className="button-spinner">
                <Spinner size={SPINNER_SIZE[props.size ?? "3"]} />
              </span>
            </>
          ) : (
            children
          )}
        </BaseButton>
      );
    },
  );
  component.displayName = displayName;
  return component;
}

/**
 * A button that runs an action: Base UI's Button with Radix Themes' sizes,
 * variants and colors. Icons go in the children, beside the label.
 *
 * @import import { Button } from "@agent-native/toolkit/ui/base-ui/button";
 */
const Button = createButton("button", "Button");

/**
 * A square button that holds only an icon, named by its `aria-label`. It is
 * the Button in every other way.
 *
 * @import import { IconButton } from "@agent-native/toolkit/ui/base-ui/button";
 */
const IconButton = createButton("icon-button", "IconButton");

export { Button, IconButton };
