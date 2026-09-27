import { Button } from "@agent-native/toolkit/ui/button";
import { IconAlertTriangle, IconCloudUpload } from "@tabler/icons-react";
import { useRef, type RefObject } from "react";

import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "./components/ui/popover.js";
import { useT } from "./i18n.js";
import { DeferredBuilderConnectPopover as BuilderConnectPopover } from "./settings/deferred-builder-connect-popover.js";
import { BuilderConnectCard } from "./setup-connections/BuilderConnectCard.js";

type FileStorageSetupPopoverCommonProps = {
  open: boolean;
  onOpenChange: (open: boolean, reason?: FileStorageSetupCloseReason) => void;
  onConnected?: () => void;
  anchorRef?: RefObject<HTMLElement | null>;
};

export type FileStorageSetupCloseReason = "dismiss" | "setup" | "connected";

export type FileStorageSetupPopoverProps =
  | (FileStorageSetupPopoverCommonProps & {
      status?: "missing";
      onRetry?: never;
    })
  | (FileStorageSetupPopoverCommonProps & {
      status: "unavailable";
      onRetry: () => void;
    });

type VirtualPopoverAnchor =
  | HTMLElement
  | { getBoundingClientRect: () => DOMRect };

/** Show storage setup only from an upload attempt, anchored to that control. */
export function FileStorageSetupPopover(props: FileStorageSetupPopoverProps) {
  const { open, onOpenChange, onConnected, anchorRef } = props;
  const status = props.status ?? "missing";
  const onRetry = props.status === "unavailable" ? props.onRetry : undefined;
  const t = useT();
  const virtualAnchorRef = useRef<VirtualPopoverAnchor>({
    getBoundingClientRect: () =>
      new DOMRect(window.innerWidth / 2, window.innerHeight / 2, 0, 0),
  });

  if (open && typeof document !== "undefined") {
    const focusedElement =
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body
        ? document.activeElement
        : null;
    const anchor = anchorRef?.current;
    virtualAnchorRef.current =
      (focusedElement && (!anchor || anchor.contains(focusedElement))
        ? focusedElement
        : anchor?.querySelector<HTMLElement>(
            '[data-agent-composer-slot="toolbar"] button',
          )) ??
      anchor ??
      virtualAnchorRef.current;
  }

  const title = t("onboarding.fileStorage.title");

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) =>
        onOpenChange(nextOpen, nextOpen ? undefined : "dismiss")
      }
    >
      <PopoverAnchor virtualRef={virtualAnchorRef} />
      <PopoverContent
        side="bottom"
        align="center"
        aria-label={
          status === "unavailable"
            ? t("onboarding.fileStorage.statusUnavailable")
            : title
        }
        className="w-72 gap-2 p-3"
      >
        {status === "unavailable" ? (
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-medium leading-5">
              <IconAlertTriangle
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground"
              />
              {t("onboarding.fileStorage.statusUnavailable")}
            </h2>
            <Button
              type="button"
              size="sm"
              variant="link"
              className="h-auto shrink-0 p-0 font-medium"
              onClick={onRetry}
            >
              {t("agentChat.common.retry")}
            </Button>
          </div>
        ) : (
          <>
            <h2 className="flex items-center gap-2 text-sm font-medium leading-5">
              <IconCloudUpload
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground"
              />
              {title}
            </h2>
            <BuilderConnectCard
              title={title}
              description=""
              trackingSource="file_upload_chat_popover"
              onConnected={onConnected}
              render={({ viewModel }) => {
                const flow = viewModel.connectFlow;
                const connectButton = (
                  <Button
                    type="button"
                    className="w-full"
                    disabled={!flow || viewModel.pending}
                    aria-busy={viewModel.pending}
                  >
                    {t("composer.connectBuilder")}
                  </Button>
                );

                return (
                  <div className="grid gap-2">
                    {flow ? (
                      <BuilderConnectPopover
                        flow={flow}
                        defaultProvisionAccount
                        onConnect={(provisionAccount) =>
                          flow.start({ provisionAccount })
                        }
                      >
                        {connectButton}
                      </BuilderConnectPopover>
                    ) : (
                      connectButton
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={() => {
                        onOpenChange(false, "setup");
                        if (typeof window !== "undefined") {
                          window.dispatchEvent(
                            new CustomEvent("agent-panel:open-settings", {
                              detail: { section: "uploads" },
                            }),
                          );
                        }
                      }}
                    >
                      {t("onboarding.fileStorage.custom")}
                    </Button>
                    {viewModel.error ? (
                      <p className="text-xs text-destructive">
                        {viewModel.error}
                      </p>
                    ) : null}
                  </div>
                );
              }}
            />
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
