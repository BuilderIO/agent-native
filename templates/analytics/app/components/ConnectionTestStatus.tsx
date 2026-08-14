import { useT } from "@agent-native/core/client/i18n";
import { IconAlertCircle, IconCheck, IconLoader2 } from "@tabler/icons-react";

export type ConnectionTestResult = { ok: boolean; error?: string };

export function ConnectionTestStatus({
  result,
  pending,
  error,
}: {
  result: ConnectionTestResult | null;
  pending: boolean;
  error: unknown;
}) {
  const t = useT();

  if (pending) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 text-xs text-muted-foreground"
      >
        <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
        {t("dataSources.testing")}
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="flex items-center gap-2 text-xs text-rose-400"
      >
        <IconAlertCircle className="h-3.5 w-3.5" />
        {error instanceof Error && error.message
          ? error.message
          : t("dataSources.connectionFailed")}
      </div>
    );
  }

  if (!result) return null;

  return (
    <div
      role={result.ok ? "status" : "alert"}
      aria-live="polite"
      className={`flex items-center gap-2 text-xs ${result.ok ? "text-emerald-500" : "text-rose-400"}`}
    >
      {result.ok ? (
        <>
          <IconCheck className="h-3.5 w-3.5" />
          {t("dataSources.connectionSuccessful")}
        </>
      ) : (
        <>
          <IconAlertCircle className="h-3.5 w-3.5" />
          {result.error || t("dataSources.connectionFailed")}
        </>
      )}
    </div>
  );
}
