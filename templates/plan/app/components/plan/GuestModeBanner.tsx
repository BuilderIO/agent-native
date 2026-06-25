import { useT } from "@agent-native/core/client";
import { IconCloudUpload } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";

/**
 * Slim, non-modal "you're a guest" strip for unauthenticated hosted visitors.
 * Public plans can still be viewed without an account, but creating a plan needs
 * the signed-in agent flow so wireframes come from AI instead of placeholders.
 */
export function GuestModeBanner({ onSignIn }: { onSignIn: () => void }) {
  const t = useT();
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border bg-muted/40 px-4 py-2">
      <IconCloudUpload className="size-4 shrink-0 text-muted-foreground" />
      <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
        {t("guest.banner")}
      </p>
      <Button type="button" size="sm" onClick={onSignIn} className="shrink-0">
        {t("guest.signIn")}
      </Button>
    </div>
  );
}
