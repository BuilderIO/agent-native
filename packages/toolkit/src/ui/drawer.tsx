import * as React from "react";
import { Drawer as DrawerPrimitive } from "vaul";

import { cn } from "../utils.js";

const Drawer = ({
  shouldScaleBackground = true,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Root>) => (
  <DrawerPrimitive.Root
    shouldScaleBackground={shouldScaleBackground}
    {...props}
  />
);
Drawer.displayName = "Drawer";

const DrawerTrigger: typeof DrawerPrimitive.Trigger = DrawerPrimitive.Trigger;

const DrawerPortal = DrawerPrimitive.Portal;

const DrawerClose: typeof DrawerPrimitive.Close = DrawerPrimitive.Close;

type DrawerOverlayElement = React.ElementRef<typeof DrawerPrimitive.Overlay>;
type DrawerOverlayProps = React.ComponentPropsWithoutRef<
  typeof DrawerPrimitive.Overlay
>;

const DrawerOverlay: React.ForwardRefExoticComponent<
  DrawerOverlayProps & React.RefAttributes<DrawerOverlayElement>
> = React.forwardRef<DrawerOverlayElement, DrawerOverlayProps>(
  ({ className, ...props }, ref) => (
    <DrawerPrimitive.Overlay
      ref={ref}
      className={cn("fixed inset-0 z-[250] bg-black/80", className)}
      {...props}
    />
  ),
);
DrawerOverlay.displayName = DrawerPrimitive.Overlay.displayName;

type DrawerContentElement = React.ElementRef<typeof DrawerPrimitive.Content>;
type DrawerContentProps = React.ComponentPropsWithoutRef<
  typeof DrawerPrimitive.Content
>;

const DrawerContent: React.ForwardRefExoticComponent<
  DrawerContentProps & React.RefAttributes<DrawerContentElement>
> = React.forwardRef<DrawerContentElement, DrawerContentProps>(
  ({ className, children, ...props }, ref) => (
    <DrawerPortal>
      <DrawerOverlay />
      <DrawerPrimitive.Content
        ref={ref}
        className={cn(
          "fixed inset-x-0 bottom-0 z-[250] mt-24 flex h-auto flex-col rounded-t-[10px] border bg-background",
          className,
        )}
        {...props}
      >
        <div className="mx-auto mt-4 h-2 w-[100px] rounded-full bg-muted" />
        {children}
      </DrawerPrimitive.Content>
    </DrawerPortal>
  ),
);
DrawerContent.displayName = "DrawerContent";

const DrawerHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("grid gap-1.5 p-4 text-center sm:text-start", className)}
    {...props}
  />
);
DrawerHeader.displayName = "DrawerHeader";

const DrawerFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("mt-auto flex flex-col gap-2 p-4", className)}
    {...props}
  />
);
DrawerFooter.displayName = "DrawerFooter";

type DrawerTitleElement = React.ElementRef<typeof DrawerPrimitive.Title>;
type DrawerTitleProps = React.ComponentPropsWithoutRef<
  typeof DrawerPrimitive.Title
>;

const DrawerTitle: React.ForwardRefExoticComponent<
  DrawerTitleProps & React.RefAttributes<DrawerTitleElement>
> = React.forwardRef<DrawerTitleElement, DrawerTitleProps>(
  ({ className, ...props }, ref) => (
    <DrawerPrimitive.Title
      ref={ref}
      className={cn(
        "text-lg font-semibold leading-none tracking-tight",
        className,
      )}
      {...props}
    />
  ),
);
DrawerTitle.displayName = DrawerPrimitive.Title.displayName;

type DrawerDescriptionElement = React.ElementRef<
  typeof DrawerPrimitive.Description
>;
type DrawerDescriptionProps = React.ComponentPropsWithoutRef<
  typeof DrawerPrimitive.Description
>;

const DrawerDescription: React.ForwardRefExoticComponent<
  DrawerDescriptionProps & React.RefAttributes<DrawerDescriptionElement>
> = React.forwardRef<DrawerDescriptionElement, DrawerDescriptionProps>(
  ({ className, ...props }, ref) => (
    <DrawerPrimitive.Description
      ref={ref}
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  ),
);
DrawerDescription.displayName = DrawerPrimitive.Description.displayName;

export {
  Drawer,
  DrawerPortal,
  DrawerOverlay,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
};
