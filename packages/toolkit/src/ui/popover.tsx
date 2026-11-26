import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as React from "react";

import { cn } from "../utils.js";
import {
  useFocusReturn,
  FocusReturnScope,
  useNativeTriggerRef,
} from "./focus-return.js";
import { useInModalLayer } from "./modal-layer.js";

const PopoverModalContext = React.createContext(false);

// Modal inside a dialog or sheet: its content joins the scroll lock's allowed layers, so the wheel scrolls it.
function Popover({
  modal,
  children,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  const inModalLayer = useInModalLayer();
  const resolvedModal = modal ?? inModalLayer;
  return (
    <PopoverModalContext.Provider value={resolvedModal}>
      <PopoverPrimitive.Root modal={resolvedModal} {...props}>
        <FocusReturnScope>{children}</FocusReturnScope>
      </PopoverPrimitive.Root>
    </PopoverModalContext.Provider>
  );
}

const PopoverTrigger = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Trigger>
>((props, ref) => {
  const triggerRef = useNativeTriggerRef(ref);
  return <PopoverPrimitive.Trigger {...props} ref={triggerRef} />;
});
PopoverTrigger.displayName = PopoverPrimitive.Trigger.displayName;

const PopoverAnchor = PopoverPrimitive.Anchor;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> & {
    portalled?: boolean;
    container?: React.ComponentPropsWithoutRef<
      typeof PopoverPrimitive.Portal
    >["container"];
  }
>(
  (
    {
      className,
      align = "center",
      sideOffset = 4,
      portalled = true,
      container,
      onCloseAutoFocus,
      onFocusOutside,
      onInteractOutside,
      ...props
    },
    ref,
  ) => {
    const focusReturn = useFocusReturn(ref);
    const modal = React.useContext(PopoverModalContext);
    const interactedOutside = React.useRef(false);
    const content = (
      <PopoverPrimitive.Content
        ref={focusReturn.ref}
        onInteractOutside={(event) => {
          onInteractOutside?.(event);
          if (!modal && !event.defaultPrevented)
            interactedOutside.current = true;
        }}
        onFocusOutside={(event) => {
          onFocusOutside?.(event);
          focusReturn.focusOutside(event, modal);
        }}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event);
          if (!interactedOutside.current) focusReturn.close(event, true);
          interactedOutside.current = false;
        }}
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-[290] w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none origin-[var(--radix-popover-content-transform-origin)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 motion-reduce:data-[state=open]:zoom-in-100 motion-reduce:data-[state=closed]:zoom-out-100 motion-reduce:data-[side=bottom]:slide-in-from-top-0 motion-reduce:data-[side=left]:slide-in-from-right-0 motion-reduce:data-[side=right]:slide-in-from-left-0 motion-reduce:data-[side=top]:slide-in-from-bottom-0",
          className,
        )}
        {...props}
      />
    );

    if (!portalled) return content;

    return (
      <PopoverPrimitive.Portal container={container}>
        {content}
      </PopoverPrimitive.Portal>
    );
  },
);
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverAnchor, PopoverContent };
