import { cloneElement, lazy, Suspense } from "react";

import { useT } from "../i18n.js";
import { LazyChunkErrorBoundary } from "../lazy-chunk-error-boundary.js";
import type { BuilderConnectPopoverProps } from "./BuilderConnectPopover.js";

const LazyBuilderConnectPopover = lazy(() =>
  import("./BuilderConnectPopover.js").then((module) => ({
    default: module.BuilderConnectPopover,
  })),
);

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

export function DeferredBuilderConnectPopover(
  props: BuilderConnectPopoverProps,
) {
  return (
    <LazyChunkErrorBoundary fallback={<LazyChunkRetryFallback />}>
      <Suspense
        fallback={cloneElement(props.children, {
          disabled: true,
          "aria-busy": true,
        })}
      >
        <LazyBuilderConnectPopover {...props} />
      </Suspense>
    </LazyChunkErrorBoundary>
  );
}
