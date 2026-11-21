import {
  type SpinnerOwnProps,
  spinnerProps,
} from "@agent-native/design-system";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type { ComponentProps } from "react";

import { splitProps } from "./props.js";

type OwnProps<Tag extends "span"> = ComponentProps<Tag> & {
  [attribute: `data-${string}`]: string | undefined;
};

export interface SpinnerProps
  extends useRender.ComponentProps<"span">, SpinnerOwnProps {
  /** Names the wait for assistive technology; without it the spinner is decorative. */
  label?: string;
}

/**
 * An indeterminate wait, as Radix Themes' Spinner. Once loading ends it renders
 * its children instead, so a control can hold its place for it.
 *
 * @import import { Spinner } from "@agent-native/toolkit/ui/base-ui/spinner";
 */
function Spinner(props: SpinnerProps) {
  const [attributes, { render, label, children, ...rest }] = splitProps(
    spinnerProps,
    props,
  );
  const element = useRender({
    defaultTagName: "span",
    render,
    props: mergeProps<"span">(
      {
        className: "spinner",
        ...attributes,
        ...(label === undefined
          ? { "aria-hidden": true }
          : { role: "status", "aria-label": label }),
      } satisfies OwnProps<"span">,
      rest,
    ),
  });
  return props.loading === false ? children : element;
}

export { Spinner };
