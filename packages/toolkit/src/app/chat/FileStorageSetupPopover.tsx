import { useT } from "@agent-native/core/client/i18n";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@agent-native/toolkit/ui/popover";
import { IconCloudUpload } from "@tabler/icons-react";
import { useRef, type RefObject } from "react";

import { DeferredBuilderConnectPopover as BuilderConnectPopover } from "../settings/deferred-builder-connect-popover.js";
import { BuilderConnectCard } from "../setup-connections/BuilderConnectCard.js";

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
  // ponytail: wide home composers open left; add an explicit placement prop if a wide sidebar needs another side.
  const useLeftSide =
    (anchorRef?.current?.getBoundingClientRect().width ?? 0) >= 500;

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) =>
        onOpenChange(nextOpen, nextOpen ? undefined : "dismiss")
      }
    >
      <PopoverAnchor virtualRef={virtualAnchorRef} />
      <PopoverContent
        side={useLeftSide ? "left" : "top"}
        align={useLeftSide ? "end" : "center"}
        sideOffset={useLeftSide ? 8 : 4}
        onOpenAutoFocus={(event) => {
          const content = event.currentTarget;
          if (!(content instanceof HTMLElement)) return;
          const firstAction = content.querySelector<HTMLButtonElement>(
            "button:not(:disabled)",
          );
          if (!firstAction) return;
          event.preventDefault();
          firstAction.focus();
        }}
        aria-label={
          status === "unavailable"
            ? t("onboarding.fileStorage.statusUnavailable")
            : title
        }
        className={
          status === "unavailable"
            ? "w-[256px] gap-2 p-2"
            : "w-[288px] gap-1 p-2"
        }
      >
        {status === "unavailable" ? (
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-medium leading-5">
              <IconCloudUpload
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground"
              />
              {t("onboarding.fileStorage.statusUnavailable")}
            </h2>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="shrink-0"
              onClick={onRetry}
            >
              {t("agentChat.common.retry")}
            </Button>
          </div>
        ) : (
          <BuilderConnectCard
            title={title}
            trackingSource="file_upload_chat_popover"
            onConnected={onConnected}
            render={({ viewModel }) => {
              const flow = viewModel.connectFlow;
              const connectButton = (
                <Button
                  type="button"
                  size="sm"
                  className="min-w-0 flex-1 px-2 text-xs"
                  disabled={!flow || viewModel.pending}
                  aria-busy={viewModel.pending}
                >
                  {t("composer.connectBuilder")}
                </Button>
              );

              return (
                <div className={viewModel.error ? "grid gap-1.5" : undefined}>
                  <div className="mt-2 flex gap-1.5">
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
                      size="sm"
                      variant="outline"
                      className="min-w-0 flex-1 px-2 text-xs"
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
                  </div>
                  {viewModel.error ? (
                    <p className="text-xs text-destructive">
                      {viewModel.error}
                    </p>
                  ) : null}
                </div>
              );
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
