import { LoaderCircle } from "lucide-react";

import { cn } from "@/lib/utils";

export function Spinner({
  className,
  ...props
}: React.ComponentProps<typeof LoaderCircle>) {
  return (
    <LoaderCircle
      className={cn("h-6 w-6 animate-spin text-muted-foreground/50", className)}
      {...props}
    />
  );
}
