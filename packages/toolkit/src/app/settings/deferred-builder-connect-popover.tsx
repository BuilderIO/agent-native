import { cloneElement, lazy, Suspense } from "react";

import { LazyChunkErrorBoundary } from "../shared/LazyChunkErrorBoundary.js";
import { LazyChunkRetryFallback } from "../shared/LazyChunkRetryFallback.js";
import type { BuilderConnectPopoverProps } from "./BuilderConnectPopover.js";

const LazyBuilderConnectPopover = lazy(() =>
  import("./BuilderConnectPopover.js").then((module) => ({
    default: module.BuilderConnectPopover,
  })),
);

export { LazyChunkRetryFallback } from "../shared/LazyChunkRetryFallback.js";

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
