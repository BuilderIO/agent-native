import { useT } from "@agent-native/core/client";
import { IconAlertCircle, IconRefresh } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";

export function QueryErrorState({
  onRetry,
  compact = false,
}: {
  onRetry: () => void;
  compact?: boolean;
}) {
  const t = useT();

  return (
    <div
      className={
        compact
          ? "flex h-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-destructive/30 bg-destructive/5 p-4 text-center"
          : "flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-destructive/30 bg-destructive/5 py-10 text-center"
      }
    >
      <IconAlertCircle className="size-5 text-destructive/70" />
      <p className="text-sm text-muted-foreground">{t("common.loadFailed")}</p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        <IconRefresh className="size-3.5" />
        {t("common.retry")}
      </Button>
    </div>
  );
}
