import { cloneElement, lazy, Suspense } from "react";

import { LazyChunkErrorBoundary } from "../lazy-chunk-error-boundary.js";
import { LazyChunkRetryFallback } from "../lazy-chunk-retry-fallback.js";
import type { BuilderConnectPopoverProps } from "./BuilderConnectPopover.js";

const LazyBuilderConnectPopover = lazy(() =>
  import("./BuilderConnectPopover.js").then((module) => ({
    default: module.BuilderConnectPopover,
  })),
);

export { LazyChunkRetryFallback } from "../lazy-chunk-retry-fallback.js";

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
