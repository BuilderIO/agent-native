import {
  type ButtonLinkOwnProps,
  buttonLinkProps,
  type ButtonOwnProps,
  buttonProps,
} from "@agent-native/design-system";
import { Button as BaseButton } from "@base-ui/react/button";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import * as React from "react";

import { swappable } from "../../design-system/primitives.js";
import { cn } from "../../utils.js";
import { partClassName } from "./part-class.js";
import { splitProps } from "./props.js";

export interface ButtonProps
  extends Omit<BaseButton.Props, "color">, ButtonOwnProps {}

export type IconButtonProps = ButtonProps;

type AnchorProps = Omit<
  useRender.ComponentProps<"a">,
  "color" | "href" | "ref" | "render"
>;

export type ButtonLinkProps = AnchorProps &
  ButtonLinkOwnProps &
  (
    | { href: string; render?: undefined }
    | {
        href?: string;
        render: NonNullable<useRender.ComponentProps<"a">["render"]>;
      }
  );

export type IconButtonLinkProps = ButtonLinkProps;

function createButton(part: "button" | "icon-button", displayName: string) {
  const component = React.forwardRef<HTMLButtonElement, ButtonProps>(
    (props, ref) => {
      const [attributes, { className, disabled, ...rest }] = splitProps(
        buttonProps,
        props,
      );
      const loading = props.loading === true;
      return (
        <BaseButton
          ref={ref}
          {...rest}
          {...attributes}
          className={partClassName(part, className)}
          disabled={disabled === true || loading}
          aria-busy={loading || rest["aria-busy"]}
        />
      );
    },
  );
  component.displayName = displayName;
  return component;
}

function createButtonLink(part: "button" | "icon-button", displayName: string) {
  const component = React.forwardRef<HTMLAnchorElement, ButtonLinkProps>(
    ({ render, className, ...props }, ref) => {
      const [attributes, rest] = splitProps(buttonLinkProps, props);
      return useRender({
        defaultTagName: "a",
        render,
        ref,
        props: mergeProps<"a">(rest, attributes, {
          className: cn(part, className),
        }),
      });
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
const Button = swappable("Button", createButton("button", "Button"));

/**
 * A square button that holds only an icon, named by its `aria-label`. It is
 * the Button in every other way.
 *
 * @import import { IconButton } from "@agent-native/toolkit/ui/base-ui/button";
 */
const IconButton = swappable(
  "IconButton",
  createButton("icon-button", "IconButton"),
);

/**
 * A link that looks like a Button: an `<a href>` that keeps its link role, so
 * screen readers list it with links and it opens in a new tab like any link.
 * Render a router link through `render`. It takes Button's look but not
 * `loading` or `disabled`, which a link has no meaning for.
 *
 * @import import { ButtonLink } from "@agent-native/toolkit/ui/base-ui/button";
 */
const ButtonLink = swappable(
  "ButtonLink",
  createButtonLink("button", "ButtonLink"),
);

/**
 * An Icon Button that is a link, named by its `aria-label`. It is the
 * ButtonLink in every other way.
 *
 * @import import { IconButtonLink } from "@agent-native/toolkit/ui/base-ui/button";
 */
const IconButtonLink = swappable(
  "IconButtonLink",
  createButtonLink("icon-button", "IconButtonLink"),
);

export { Button, ButtonLink, IconButton, IconButtonLink };
