import { IconLoader2 } from "@tabler/icons-react";

import { cn } from "@/lib/utils";

export function Spinner({
  className,
  ...props
}: React.ComponentProps<typeof IconLoader2>) {
  return (
    <IconLoader2
      className={cn("h-6 w-6 animate-spin text-muted-foreground/50", className)}
      {...props}
    />
  );
}
