import { useT } from "@agent-native/core/client";
import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";

import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";

interface ActionQueryErrorProps {
  error?: unknown;
  onRetry: () => unknown;
  className?: string;
}

export function ActionQueryError({
  error,
  onRetry,
  className,
}: ActionQueryErrorProps) {
  const t = useT();
  const message =
    error instanceof Error && error.message
      ? error.message
      : t("dispatch.pages.dataLoadFailedDescription");

  return (
    <Alert variant="destructive" className={className}>
      <IconAlertTriangle className="size-4" />
      <AlertTitle>{t("dispatch.pages.dataLoadFailed")}</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>{message}</span>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          <IconRefresh className="size-4" />
          {t("dispatch.pages.tryAgain")}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
