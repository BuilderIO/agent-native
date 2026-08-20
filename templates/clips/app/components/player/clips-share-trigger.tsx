import {
  ShareTrigger,
  type ShareTriggerProps,
} from "@agent-native/toolkit/sharing";

import { cn } from "@/lib/utils";

export function ClipsShareTrigger({ className, ...props }: ShareTriggerProps) {
  return (
    <ShareTrigger
      {...props}
      intent="primary"
      emphasis="solid"
      className={cn("clips-share-trigger shrink-0", className)}
    />
  );
}
