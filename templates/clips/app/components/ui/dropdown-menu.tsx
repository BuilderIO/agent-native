import { cn } from "@agent-native/toolkit/utils";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { IconCheck } from "@tabler/icons-react";
import * as React from "react";

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
} from "@agent-native/toolkit/ui/dropdown-menu";

// Clips-owned override: the toolkit default puts the radio indicator (a dot)
// on the leading edge with the label padded past it. This app shows a
// checkmark on the trailing edge instead, matching the surface/device
// pickers' "label, then confirmation" reading order.
const DropdownMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.RadioItem
    ref={ref}
    className={cn(
      "relative flex cursor-pointer select-none items-center gap-2 rounded-sm py-1.5 ps-2 pe-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className,
    )}
    {...props}
  >
    <span className="flex-1 truncate">{children}</span>
    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <IconCheck className="h-4 w-4" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
  </DropdownMenuPrimitive.RadioItem>
));
DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName;

export { DropdownMenuRadioItem };
