import {
  ShareTrigger,
  type ShareTriggerProps,
} from "@agent-native/toolkit/sharing";

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
      label={label}
      intent="primary"
      emphasis="solid"
      className={cn("clips-share-trigger", className)}
    />
  );
}
