import * as React from "react";

import { Button, type ButtonProps } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectTrigger } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type ViewerInputProps = React.ComponentPropsWithoutRef<typeof Input>;
type ViewerSelectTriggerProps = React.ComponentPropsWithoutRef<
  typeof SelectTrigger
>;
type ViewerSwitchProps = React.ComponentPropsWithoutRef<typeof Switch>;
type ViewerTabsListProps = React.ComponentPropsWithoutRef<typeof TabsList>;
type ViewerTabsTriggerProps = React.ComponentPropsWithoutRef<
  typeof TabsTrigger
>;

export const ViewerButton = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, size = "sm", ...props }, ref) => (
    <Button
      ref={ref}
      size={size}
      className={cn("h-8 px-2.5 text-xs", className)}
      {...props}
    />
  ),
);
ViewerButton.displayName = "ViewerButton";

export const ViewerIconButton = React.forwardRef<
  HTMLButtonElement,
  Omit<ButtonProps, "size">
>(({ className, ...props }, ref) => (
  <Button
    ref={ref}
    size="icon"
    className={cn("size-8", className)}
    {...props}
  />
));
ViewerIconButton.displayName = "ViewerIconButton";

export const ViewerInput = React.forwardRef<
  React.ElementRef<typeof Input>,
  ViewerInputProps
>(({ className, ...props }, ref) => (
  <Input ref={ref} className={cn("h-8 px-2.5 text-sm", className)} {...props} />
));
ViewerInput.displayName = "ViewerInput";

export const ViewerSelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectTrigger>,
  ViewerSelectTriggerProps
>(({ className, ...props }, ref) => (
  <SelectTrigger
    ref={ref}
    className={cn("h-8 px-2.5 text-sm", className)}
    {...props}
  />
));
ViewerSelectTrigger.displayName = "ViewerSelectTrigger";

export const ViewerSwitch = React.forwardRef<
  React.ElementRef<typeof Switch>,
  ViewerSwitchProps
>(({ className, ...props }, ref) => (
  <Switch
    ref={ref}
    className={cn(
      "relative !h-4 !w-7 after:absolute after:-inset-2 after:content-[''] [&>span]:!size-3 [&>span[data-state=checked]]:!translate-x-3 [&>span[data-state=unchecked]]:!translate-x-0",
      className,
    )}
    {...props}
  />
));
ViewerSwitch.displayName = "ViewerSwitch";

export const ViewerTabsList = React.forwardRef<
  React.ElementRef<typeof TabsList>,
  ViewerTabsListProps
>(({ className, ...props }, ref) => (
  <TabsList
    ref={ref}
    className={cn(
      "h-10 w-full shrink-0 justify-start gap-0 overflow-x-auto rounded-none bg-transparent p-0",
      className,
    )}
    {...props}
  />
));
ViewerTabsList.displayName = "ViewerTabsList";

export const ViewerTabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsTrigger>,
  ViewerTabsTriggerProps
>(({ children, className, ...props }, ref) => (
  <TabsTrigger
    ref={ref}
    className={cn(
      "group relative z-0 h-10 min-w-0 flex-1 rounded-none bg-transparent px-2 text-xs shadow-none hover:text-foreground focus-visible:z-10 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none",
      className,
    )}
    {...props}
  >
    <span className="relative inline-flex h-full items-center rounded-sm group-focus-visible:ring-2 group-focus-visible:ring-ring/60 group-focus-visible:ring-offset-0 after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:origin-center after:scale-x-0 after:bg-foreground after:transition-transform after:duration-150 group-data-[state=active]:after:scale-x-100 motion-reduce:after:transition-none">
      {children}
    </span>
  </TabsTrigger>
));
ViewerTabsTrigger.displayName = "ViewerTabsTrigger";
