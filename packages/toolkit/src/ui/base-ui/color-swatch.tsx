import {
  type ColorSwatchOwnProps,
  colorSwatchProps,
} from "@agent-native/design-system";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import { splitProps } from "./props.js";

export interface ColorSwatchProps
  extends useRender.ComponentProps<"span">, ColorSwatchOwnProps {
  /** Any CSS color, including translucent colors and theme tokens. */
  value: string;
}

/**
 * A paint sample over a transparency grid. Label the control that contains it.
 * For a standalone meaningful sample, supply role="img" and an accessible name.
 * @import import { ColorSwatch } from "@agent-native/toolkit/ui/base-ui/color-swatch";
 */
export function ColorSwatch(input: ColorSwatchProps) {
  const [attributes, { value, render, children, ...props }] = splitProps(
    colorSwatchProps,
    input,
  );
  return useRender({
    defaultTagName: "span",
    render,
    props: mergeProps<"span">(
      {
        ...attributes,
        className: "color-swatch",
        children: (
          <>
            <span
              className="color-swatch-paint"
              style={{ backgroundColor: value }}
            />
            {children}
          </>
        ),
      },
      props,
    ),
  });
}
