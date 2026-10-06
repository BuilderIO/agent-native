import { useT } from "@agent-native/core/client/i18n";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import { cloneElement, lazy, Suspense, useState } from "react";

import { LazyChunkErrorBoundary } from "../shared/LazyChunkErrorBoundary.js";
import { LazyChunkRetryFallback } from "../shared/LazyChunkRetryFallback.js";
import type {
  BuilderConnectChoicePanelProps,
  BuilderConnectPopoverProps,
} from "./BuilderConnectPopover.js";

const LazyBuilderConnectPopover = lazy(() =>
  import("./BuilderConnectPopover.js").then((module) => ({
    default: module.BuilderConnectPopover,
  })),
);
const LazyBuilderConnectChoicePanel = lazy(() =>
  import("./BuilderConnectPopover.js").then((module) => ({
    default: module.BuilderConnectChoicePanel,
  })),
);

export { LazyChunkRetryFallback } from "../shared/LazyChunkRetryFallback.js";

export function DeferredBuilderConnectPopover(
  props: BuilderConnectPopoverProps,
) {
  const t = useT();
  const [openAfterLoad, setOpenAfterLoad] = useState(false);

  return (
    <LazyChunkErrorBoundary fallback={<LazyChunkRetryFallback />}>
      <Suspense
        fallback={cloneElement(props.children, {
          onClick: (event) => {
            if (props.flow.connecting) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            props.children.props.onClick?.(event);
            props.onTriggerClick?.(event);
            if (event.defaultPrevented) return;
            event.preventDefault();
            event.stopPropagation();
            setOpenAfterLoad(true);
          },
        })}
      >
        <LazyBuilderConnectPopover {...props} openOnMount={openAfterLoad} />
      </Suspense>
    </LazyChunkErrorBoundary>
  );
}

export function DeferredBuilderConnectChoicePanel(
  props: BuilderConnectChoicePanelProps,
) {
  const t = useT();

  return (
    <LazyChunkErrorBoundary fallback={<LazyChunkRetryFallback />}>
      <Suspense
        fallback={
          <div className="space-y-2.5 p-1" aria-busy="true">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-8 w-full" />
            <span className="sr-only">{t("agentChat.common.loading")}</span>
          </div>
        }
      >
        <LazyBuilderConnectChoicePanel {...props} />
      </Suspense>
    </LazyChunkErrorBoundary>
  );
}
