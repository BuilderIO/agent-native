import { type ToggleOwnProps, toggleProps } from "@agent-native/design-system";
import { Toggle as BaseToggle } from "@base-ui/react/toggle";
import * as React from "react";

import { glyphOnly } from "./glyph-only.js";
import { partClassName } from "./part-class.js";
import { splitProps } from "./props.js";
import { toggleGroupItemProps } from "./toggle-group.js";

export interface ToggleProps
  extends Omit<BaseToggle.Props, "color">, ToggleOwnProps {}

/**
 * A button that stays filled while pressed, for an option that is on or off, on
 * Base UI's Toggle with Radix Themes' props. Name an icon-only toggle with
 * `aria-label`.
 *
 * @import import { Toggle } from "@agent-native/toolkit/ui/base-ui/toggle";
 */
const Toggle = React.forwardRef<HTMLButtonElement, ToggleProps>(
  (props, ref) => {
    const [attributes, { className, ...rest }] = splitProps(
      toggleProps,
      toggleGroupItemProps.useGroupProps(props),
    );
    return (
      <BaseToggle
        ref={ref}
        {...rest}
        {...attributes}
        data-icon-only={glyphOnly(rest.children) ? "" : undefined}
        className={partClassName("toggle", className)}
      />
    );
  },
);
Toggle.displayName = "Toggle";

export { Toggle };
