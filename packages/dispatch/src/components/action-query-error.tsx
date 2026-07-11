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
  onRetry,
  className,
}: ActionQueryErrorProps) {
  const t = useT();

  return (
    <Alert variant="destructive" className={className}>
      <IconAlertTriangle className="size-4" />
      <AlertTitle>{t("dispatch.pages.dataLoadFailed")}</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>{t("dispatch.pages.dataLoadFailedDescription")}</span>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          <IconRefresh className="size-4" />
          {t("dispatch.pages.tryAgain")}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
