import { useT } from "./i18n.js";

export function LazyChunkRetryFallback({
  onRetry = () => {
    if (typeof window !== "undefined") window.location.reload();
  },
}: {
  onRetry?: () => void;
} = {}) {
  const t = useT();

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
    >
      <span>{t("agentChat.common.chunkLoadFailed")}</span>
      <button
        type="button"
        onClick={onRetry}
        className="font-medium text-foreground underline underline-offset-4"
      >
        {t("agentChat.common.retry")}
      </button>
    </div>
  );
}
