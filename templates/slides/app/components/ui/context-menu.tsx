import * as ContextMenuParts from "@agent-native/toolkit/ui/context-menu";
import * as React from "react";

export * from "@agent-native/toolkit/ui/context-menu";

function instantMenuStyle(style: React.CSSProperties | undefined) {
  return { ...style, animation: "none", transition: "none" };
}

export const ContextMenuContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuParts.ContextMenuContent>,
  React.ComponentPropsWithoutRef<typeof ContextMenuParts.ContextMenuContent>
>(({ style, ...props }, ref) => (
  <ContextMenuParts.ContextMenuContent
    {...props}
    ref={ref}
    style={instantMenuStyle(style)}
  />
));
ContextMenuContent.displayName = "ContextMenuContent";

export const ContextMenuSubContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuParts.ContextMenuSubContent>,
  React.ComponentPropsWithoutRef<typeof ContextMenuParts.ContextMenuSubContent>
>(({ style, ...props }, ref) => (
  <ContextMenuParts.ContextMenuSubContent
    {...props}
    ref={ref}
    style={instantMenuStyle(style)}
  />
));
ContextMenuSubContent.displayName = "ContextMenuSubContent";
