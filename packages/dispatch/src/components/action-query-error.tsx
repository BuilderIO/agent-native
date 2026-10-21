import { useT } from "@agent-native/core/client/i18n";
import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";

import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";

interface ActionQueryErrorProps {
  error?: unknown;
  onRetry: () => unknown;
  className?: string;
  queryName?: string;
}

function actionQueryDiagnostic(
  error: unknown,
  queryName: string | undefined,
): string | null {
  const parts: string[] = [];
  if (queryName) parts.push(queryName);

  if (error && typeof error === "object") {
    const details = error as Record<string, unknown>;
    const status =
      typeof details.statusCode === "number"
        ? details.statusCode
        : details.status;
    if (
      typeof status === "number" &&
      Number.isInteger(status) &&
      status >= 100 &&
      status <= 599
    ) {
      parts.push(`HTTP ${status}`);
    }

    const code = details.errorCode ?? details.code;
    if (typeof code === "string" && /^[a-zA-Z0-9_.-]{1,80}$/.test(code)) {
      parts.push(code);
    }
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

export function ActionQueryError({
  error,
  onRetry,
  className,
  queryName,
}: ActionQueryErrorProps) {
  const t = useT();
  const diagnostic = actionQueryDiagnostic(error, queryName);

  return (
    <Alert variant="destructive" className={className}>
      <IconAlertTriangle className="size-4" />
      <AlertTitle>{t("dispatch.pages.dataLoadFailed")}</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>{t("dispatch.pages.dataLoadFailedDescription")}</span>
        {diagnostic ? (
          <code className="w-full break-all text-xs text-muted-foreground">
            {diagnostic}
          </code>
        ) : null}
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          <IconRefresh className="size-4" />
          {t("dispatch.pages.tryAgain")}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
