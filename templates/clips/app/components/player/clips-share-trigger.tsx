import {
  ShareTrigger,
  type ShareTriggerProps,
} from "@agent-native/toolkit/sharing";
import { IconUserPlus } from "@tabler/icons-react";

import { PageHeaderPrimaryAction } from "@/components/library/page-header";
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
    <PageHeaderPrimaryAction asChild>
      <ShareTrigger
        {...props}
        aria-label={accessibleLabel}
        title={title ?? accessibleLabel}
        label={
          <span className="flex items-center gap-2">
            <IconUserPlus />
            <span>{label}</span>
          </span>
        }
        intent="primary"
        emphasis="solid"
        className={cn("clips-share-trigger", className)}
      />
    </PageHeaderPrimaryAction>
  );
}
