import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

export function Spinner({
  className,
  ...props
}: React.ComponentProps<typeof Loader2>) {
  return (
    <Loader2
      className={cn("h-6 w-6 animate-spin text-muted-foreground", className)}
      {...props}
    />
  );
}
