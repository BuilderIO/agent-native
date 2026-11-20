import {
  type ToolbarOwnProps,
  toolbarProps,
} from "@agent-native/design-system";
import { Toolbar as BaseToolbar } from "@base-ui/react/toolbar";
import * as React from "react";

import { glyphOnly } from "./glyph-only.js";
import { partClassName } from "./part-class.js";
import { splitProps } from "./props.js";

export interface ToolbarProps extends BaseToolbar.Root.Props, ToolbarOwnProps {}

/**
 * A row of controls that the arrow keys move between as one tab stop, on Base
 * UI's Toolbar. Every button, link and toggle in it takes its size.
 *
 * @import import { Toolbar, ToolbarGroup, ToolbarButton, ToolbarLink, ToolbarSeparator } from "@agent-native/toolkit/ui/base-ui/toolbar";
 */
const Toolbar = React.forwardRef<HTMLDivElement, ToolbarProps>((props, ref) => {
  const [attributes, { className, ...rest }] = splitProps(toolbarProps, props);
  return (
    <BaseToolbar.Root
      ref={ref}
      {...rest}
      {...attributes}
      className={partClassName("toolbar", className)}
    />
  );
});
Toolbar.displayName = "Toolbar";

export type ToolbarGroupProps = BaseToolbar.Group.Props;

/**
 * Groups related controls in the toolbar.
 *
 * @import import { ToolbarGroup } from "@agent-native/toolkit/ui/base-ui/toolbar";
 */
const ToolbarGroup = React.forwardRef<HTMLDivElement, ToolbarGroupProps>(
  ({ className, ...props }, ref) => (
    <BaseToolbar.Group
      ref={ref}
      className={partClassName("toolbar-group", className)}
      {...props}
    />
  ),
);
ToolbarGroup.displayName = "ToolbarGroup";

export type ToolbarButtonProps = BaseToolbar.Button.Props;

/**
 * A button in the toolbar. Through `render` it can be another part, such as a
 * Toggle or a menu trigger, which keeps its own look and takes the toolbar's
 * size.
 *
 * @import import { ToolbarButton } from "@agent-native/toolkit/ui/base-ui/toolbar";
 */
const ToolbarButton = React.forwardRef<HTMLButtonElement, ToolbarButtonProps>(
  ({ className, ...props }, ref) => (
    <BaseToolbar.Button
      ref={ref}
      className={partClassName("toolbar-button", className)}
      data-icon-only={glyphOnly(props.children) ? "" : undefined}
      {...props}
    />
  ),
);
ToolbarButton.displayName = "ToolbarButton";

export type ToolbarLinkProps = BaseToolbar.Link.Props;

/**
 * A link in the toolbar.
 *
 * @import import { ToolbarLink } from "@agent-native/toolkit/ui/base-ui/toolbar";
 */
const ToolbarLink = React.forwardRef<HTMLAnchorElement, ToolbarLinkProps>(
  ({ className, ...props }, ref) => (
    <BaseToolbar.Link
      ref={ref}
      className={partClassName("toolbar-link", className)}
      data-icon-only={glyphOnly(props.children) ? "" : undefined}
      {...props}
    />
  ),
);
ToolbarLink.displayName = "ToolbarLink";

export type ToolbarSeparatorProps = BaseToolbar.Separator.Props;

/**
 * A line between groups of controls in the toolbar.
 *
 * @import import { ToolbarSeparator } from "@agent-native/toolkit/ui/base-ui/toolbar";
 */
const ToolbarSeparator = React.forwardRef<
  HTMLDivElement,
  ToolbarSeparatorProps
>(({ className, ...props }, ref) => (
  <BaseToolbar.Separator
    ref={ref}
    className={partClassName("toolbar-separator", className)}
    {...props}
  />
));
ToolbarSeparator.displayName = "ToolbarSeparator";

export { Toolbar, ToolbarGroup, ToolbarButton, ToolbarLink, ToolbarSeparator };
