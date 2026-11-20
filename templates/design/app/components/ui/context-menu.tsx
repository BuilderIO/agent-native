import * as Toolkit from "@agent-native/toolkit/ui/context-menu";
import * as React from "react";

import { cn } from "@/lib/utils";

import {
  designMenuContentClass,
  designMenuDestructiveClass,
  designMenuIndicatorItemClass,
  designMenuInsetClass,
  designMenuItemClass,
  designMenuLabelClass,
  designMenuShortcutClass,
  designMenuSubTriggerClass,
  type DesignMenuItemVariant,
} from "./menu-classes";

export {
  ContextMenu,
  ContextMenuGroup,
  ContextMenuPortal,
  ContextMenuRadioGroup,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuTrigger,
} from "@agent-native/toolkit/ui/context-menu";

const ContextMenuContent = React.forwardRef<
  React.ElementRef<typeof Toolkit.ContextMenuContent>,
  React.ComponentPropsWithoutRef<typeof Toolkit.ContextMenuContent>
>(({ className, ...props }, ref) => (
  <Toolkit.ContextMenuContent
    ref={ref}
    className={cn(designMenuContentClass, className)}
    {...props}
  />
));
ContextMenuContent.displayName = Toolkit.ContextMenuContent.displayName;

const ContextMenuSubContent = React.forwardRef<
  React.ElementRef<typeof Toolkit.ContextMenuSubContent>,
  React.ComponentPropsWithoutRef<typeof Toolkit.ContextMenuSubContent>
>(({ className, ...props }, ref) => (
  <Toolkit.ContextMenuSubContent
    ref={ref}
    className={cn(designMenuContentClass, className)}
    {...props}
  />
));
ContextMenuSubContent.displayName = Toolkit.ContextMenuSubContent.displayName;

const ContextMenuItem = React.forwardRef<
  React.ElementRef<typeof Toolkit.ContextMenuItem>,
  React.ComponentPropsWithoutRef<typeof Toolkit.ContextMenuItem> & {
    variant?: DesignMenuItemVariant;
  }
>(({ className, inset, variant = "default", ...props }, ref) => (
  <Toolkit.ContextMenuItem
    ref={ref}
    data-variant={variant}
    className={cn(
      designMenuItemClass,
      inset && designMenuInsetClass,
      variant === "destructive" && designMenuDestructiveClass,
      className,
    )}
    {...props}
  />
));
ContextMenuItem.displayName = Toolkit.ContextMenuItem.displayName;

const ContextMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof Toolkit.ContextMenuSubTrigger>,
  React.ComponentPropsWithoutRef<typeof Toolkit.ContextMenuSubTrigger>
>(({ className, inset, ...props }, ref) => (
  <Toolkit.ContextMenuSubTrigger
    ref={ref}
    className={cn(
      designMenuItemClass,
      designMenuSubTriggerClass,
      inset && designMenuInsetClass,
      className,
    )}
    {...props}
  />
));
ContextMenuSubTrigger.displayName = Toolkit.ContextMenuSubTrigger.displayName;

const ContextMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof Toolkit.ContextMenuCheckboxItem>,
  React.ComponentPropsWithoutRef<typeof Toolkit.ContextMenuCheckboxItem>
>(({ className, ...props }, ref) => (
  <Toolkit.ContextMenuCheckboxItem
    ref={ref}
    className={cn(designMenuItemClass, designMenuIndicatorItemClass, className)}
    {...props}
  />
));
ContextMenuCheckboxItem.displayName =
  Toolkit.ContextMenuCheckboxItem.displayName;

const ContextMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof Toolkit.ContextMenuRadioItem>,
  React.ComponentPropsWithoutRef<typeof Toolkit.ContextMenuRadioItem>
>(({ className, ...props }, ref) => (
  <Toolkit.ContextMenuRadioItem
    ref={ref}
    className={cn(designMenuItemClass, designMenuIndicatorItemClass, className)}
    {...props}
  />
));
ContextMenuRadioItem.displayName = Toolkit.ContextMenuRadioItem.displayName;

const ContextMenuLabel = React.forwardRef<
  React.ElementRef<typeof Toolkit.ContextMenuLabel>,
  React.ComponentPropsWithoutRef<typeof Toolkit.ContextMenuLabel>
>(({ className, inset, ...props }, ref) => (
  <Toolkit.ContextMenuLabel
    ref={ref}
    className={cn(
      designMenuLabelClass,
      inset && designMenuInsetClass,
      className,
    )}
    {...props}
  />
));
ContextMenuLabel.displayName = Toolkit.ContextMenuLabel.displayName;

const ContextMenuShortcut = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) => (
  <Toolkit.ContextMenuShortcut
    className={cn(designMenuShortcutClass, className)}
    {...props}
  />
);
ContextMenuShortcut.displayName = "ContextMenuShortcut";

export {
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioItem,
  ContextMenuShortcut,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
};
