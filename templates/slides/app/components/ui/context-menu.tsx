import * as ContextMenuParts from "@agent-native/toolkit/ui/context-menu";
import * as React from "react";

import { cn } from "@/lib/utils";

export * from "@agent-native/toolkit/ui/context-menu";

// Radix's popper replaces an inline `animation` once the menu is positioned,
// so only a class can turn the toolkit's enter animation off. Its first frame
// slides the menu under the pointer, where a right-click release picks an item.
// Important, because tailwind-merge keeps the toolkit's `animate-in` too.
const INSTANT_MENU_CLASS = "data-[state=open]:!animate-none";

function instantMenuStyle(style: React.CSSProperties | undefined) {
  return { ...style, transition: "none" };
}

export const ContextMenuContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuParts.ContextMenuContent>,
  React.ComponentPropsWithoutRef<typeof ContextMenuParts.ContextMenuContent>
>(({ className, style, ...props }, ref) => (
  <ContextMenuParts.ContextMenuContent
    {...props}
    ref={ref}
    className={cn(INSTANT_MENU_CLASS, className)}
    style={instantMenuStyle(style)}
  />
));
ContextMenuContent.displayName = "ContextMenuContent";

export const ContextMenuSubContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuParts.ContextMenuSubContent>,
  React.ComponentPropsWithoutRef<typeof ContextMenuParts.ContextMenuSubContent>
>(({ className, style, ...props }, ref) => (
  <ContextMenuParts.ContextMenuSubContent
    {...props}
    ref={ref}
    className={cn(INSTANT_MENU_CLASS, className)}
    style={instantMenuStyle(style)}
  />
));
ContextMenuSubContent.displayName = "ContextMenuSubContent";
