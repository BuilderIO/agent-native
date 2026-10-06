import { useT } from "@agent-native/core/client/i18n";
import { Button } from "@agent-native/toolkit/ui/button";
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
  const t = useT();
  if (
    props.flow.statusResolved === true &&
    props.flow.agentNativeProvisioningEnabled !== true
  ) {
    // Keep OAuth in the trusted click and avoid loading popover UI for sign-in-only flows.
    const trigger = cloneElement(props.children, {
      "aria-busy": undefined,
      onClick: (event) => {
        if (props.flow.connecting) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        props.children.props.onClick?.(event);
        props.onTriggerClick?.(event);
        if (event.defaultPrevented) return;
        if (props.onConnect) props.onConnect(false);
        else props.flow.start({ provisionAccount: false });
      },
    });
    const cancelAction =
      props.flow.connecting && props.flow.cancel ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0"
          onClick={props.flow.cancel}
        >
          {t("common.cancel")}
        </Button>
      ) : null;

    return cancelAction ? (
      <span className="inline-flex max-w-full items-center gap-2">
        <span className="contents">{trigger}</span>
        {cancelAction}
      </span>
    ) : (
      <span className="contents">{trigger}</span>
    );
  }

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
