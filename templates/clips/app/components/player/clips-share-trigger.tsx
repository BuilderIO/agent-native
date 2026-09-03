import {
  ShareTrigger,
  type ShareTriggerProps,
} from "@agent-native/toolkit/sharing";
import { IconUserPlus } from "@tabler/icons-react";

import { cn } from "@/lib/utils";

export function ClipsShareTrigger({
  className,
  label = "Share",
  title,
  "aria-label": ariaLabel,
  ...props
}: ShareTriggerProps) {
  const accessibleLabel =
    ariaLabel ?? (typeof label === "string" ? label : "Share");

  return (
    <ShareTrigger
      {...props}
      aria-label={accessibleLabel}
      title={title ?? accessibleLabel}
      label={
        <span className="flex items-center gap-1.5">
          <IconUserPlus className="size-4" />
          <span>{label}</span>
        </span>
      }
      intent="primary"
      emphasis="solid"
      className={cn("clips-share-trigger shrink-0", className)}
    />
  );
}
