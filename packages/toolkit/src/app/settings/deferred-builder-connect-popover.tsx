import { cloneElement, lazy, Suspense, useState } from "react";

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
  const [replayTriggerClick, setReplayTriggerClick] = useState(false);

  return (
    <LazyChunkErrorBoundary fallback={<LazyChunkRetryFallback />}>
      <Suspense
        fallback={cloneElement(props.children, {
          "aria-busy": true,
          onClick: (event) => {
            event.preventDefault();
            event.stopPropagation();
            setReplayTriggerClick(true);
          },
        })}
      >
        <LazyBuilderConnectPopover
          {...props}
          replayTriggerClick={replayTriggerClick}
        />
      </Suspense>
    </LazyChunkErrorBoundary>
  );
}
