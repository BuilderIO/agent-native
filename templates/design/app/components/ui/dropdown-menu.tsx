import * as Toolkit from "@agent-native/toolkit/ui/dropdown-menu";
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
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuSub,
  DropdownMenuTrailing,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui/dropdown-menu";

const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof Toolkit.DropdownMenuContent>,
  React.ComponentPropsWithoutRef<typeof Toolkit.DropdownMenuContent>
>(({ className, ...props }, ref) => (
  <Toolkit.DropdownMenuContent
    ref={ref}
    className={cn(designMenuContentClass, className)}
    {...props}
  />
));
DropdownMenuContent.displayName = Toolkit.DropdownMenuContent.displayName;

const DropdownMenuSubContent = React.forwardRef<
  React.ElementRef<typeof Toolkit.DropdownMenuSubContent>,
  React.ComponentPropsWithoutRef<typeof Toolkit.DropdownMenuSubContent>
>(({ className, ...props }, ref) => (
  <Toolkit.DropdownMenuSubContent
    ref={ref}
    className={cn(designMenuContentClass, className)}
    {...props}
  />
));
DropdownMenuSubContent.displayName = Toolkit.DropdownMenuSubContent.displayName;

const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof Toolkit.DropdownMenuItem>,
  React.ComponentPropsWithoutRef<typeof Toolkit.DropdownMenuItem> & {
    variant?: DesignMenuItemVariant;
  }
>(({ className, inset, variant = "default", ...props }, ref) => (
  <Toolkit.DropdownMenuItem
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
DropdownMenuItem.displayName = Toolkit.DropdownMenuItem.displayName;

const DropdownMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof Toolkit.DropdownMenuSubTrigger>,
  React.ComponentPropsWithoutRef<typeof Toolkit.DropdownMenuSubTrigger>
>(({ className, inset, ...props }, ref) => (
  <Toolkit.DropdownMenuSubTrigger
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
DropdownMenuSubTrigger.displayName = Toolkit.DropdownMenuSubTrigger.displayName;

const DropdownMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof Toolkit.DropdownMenuCheckboxItem>,
  React.ComponentPropsWithoutRef<typeof Toolkit.DropdownMenuCheckboxItem>
>(({ className, ...props }, ref) => (
  <Toolkit.DropdownMenuCheckboxItem
    ref={ref}
    className={cn(designMenuItemClass, designMenuIndicatorItemClass, className)}
    {...props}
  />
));
DropdownMenuCheckboxItem.displayName =
  Toolkit.DropdownMenuCheckboxItem.displayName;

const DropdownMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof Toolkit.DropdownMenuRadioItem>,
  React.ComponentPropsWithoutRef<typeof Toolkit.DropdownMenuRadioItem>
>(({ className, indicator = "check", ...props }, ref) => (
  <Toolkit.DropdownMenuRadioItem
    ref={ref}
    indicator={indicator}
    className={cn(designMenuItemClass, designMenuIndicatorItemClass, className)}
    {...props}
  />
));
DropdownMenuRadioItem.displayName = Toolkit.DropdownMenuRadioItem.displayName;

const DropdownMenuLabel = React.forwardRef<
  React.ElementRef<typeof Toolkit.DropdownMenuLabel>,
  React.ComponentPropsWithoutRef<typeof Toolkit.DropdownMenuLabel>
>(({ className, inset, ...props }, ref) => (
  <Toolkit.DropdownMenuLabel
    ref={ref}
    className={cn(
      designMenuLabelClass,
      inset && designMenuInsetClass,
      className,
    )}
    {...props}
  />
));
DropdownMenuLabel.displayName = Toolkit.DropdownMenuLabel.displayName;

const DropdownMenuSeparator = Toolkit.DropdownMenuSeparator;

const DropdownMenuShortcut = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) => (
  <Toolkit.DropdownMenuShortcut
    className={cn(designMenuShortcutClass, className)}
    {...props}
  />
);
DropdownMenuShortcut.displayName = "DropdownMenuShortcut";

export {
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
};
