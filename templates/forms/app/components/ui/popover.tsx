import {
  Popover,
  PopoverAnchor,
  PopoverContent as ToolkitPopoverContent,
  PopoverTrigger,
} from "@agent-native/toolkit/ui/popover";
import * as React from "react";

import { cn } from "@/lib/utils";

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof ToolkitPopoverContent>,
  React.ComponentPropsWithoutRef<typeof ToolkitPopoverContent>
>(({ className, collisionPadding = 16, ...props }, ref) => (
  <ToolkitPopoverContent
    ref={ref}
    collisionPadding={collisionPadding}
    className={cn("max-w-[calc(100vw-2rem)]", className)}
    {...props}
  />
));

PopoverContent.displayName = ToolkitPopoverContent.displayName;

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger };
