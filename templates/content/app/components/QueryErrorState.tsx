import { useT } from "@agent-native/core/client";
import { IconAlertTriangle } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";

export function QueryErrorState({
  onRetry,
  retrying = false,
  compact = false,
}: {
  onRetry: () => void;
  retrying?: boolean;
  compact?: boolean;
}) {
  const t = useT();

  return (
    <div
      className={
        compact
          ? "flex flex-col items-center gap-2 px-3 py-4 text-center"
          : "flex flex-1 items-center justify-center bg-background px-6"
      }
    >
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <IconAlertTriangle className="size-7 text-destructive" />
        <p className="text-sm text-destructive">{t("empty.genericError")}</p>
        <Button
          size="sm"
          variant="outline"
          onClick={onRetry}
          disabled={retrying}
        >
          {t("database.retry")}
        </Button>
      </div>
    </div>
  );
}
