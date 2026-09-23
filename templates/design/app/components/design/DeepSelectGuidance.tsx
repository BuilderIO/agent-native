import { useT } from "@agent-native/core/client/i18n";
import { IconX } from "@tabler/icons-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { useApplePlatform } from "@/hooks/use-shortcut-label";

const DEEP_SELECT_GUIDANCE_VISIBLE_MS = 5000;

export function DeepSelectGuidance({
  onDismiss,
  onExpire,
}: {
  onDismiss: () => void;
  onExpire: () => void;
}) {
  const t = useT();
  const modifier = useApplePlatform() ? "⌘" : "Ctrl";

  useEffect(() => {
    const timer = window.setTimeout(onExpire, DEEP_SELECT_GUIDANCE_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [onExpire]);

  return (
    <div
      data-design-deep-select-guidance
      className="pointer-events-none absolute inset-x-0 top-4 z-[70] flex justify-center px-4"
      onClick={(event) => event.stopPropagation()}
    >
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto relative max-w-[24rem] rounded-lg border bg-card px-4 py-3 pr-10 text-xs text-muted-foreground shadow-md"
      >
        {t("designEditor.deepSelectGuidance.message", { modifier })}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-1.5 top-1.5 size-6"
          aria-label={t("designEditor.deepSelectGuidance.dismiss")}
          onClick={onDismiss}
        >
          <IconX className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
