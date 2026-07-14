import { useT } from "@agent-native/core/client";
import { IconAlertTriangle } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";

export function QueryErrorState({
  onRetry,
  retrying = false,
}: {
  onRetry: () => void;
  retrying?: boolean;
}) {
  const t = useT();

  return (
    <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-xl border border-destructive/30 px-6 py-12 text-center">
      <IconAlertTriangle className="size-8 text-destructive" />
      <p className="text-sm text-destructive">{t("common.genericError")}</p>
      <Button size="sm" variant="outline" onClick={onRetry} disabled={retrying}>
        {t("chat.figmaLink.retry")}
      </Button>
    </div>
  );
}
