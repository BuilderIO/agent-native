import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { useAfterPaint } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@agent-native/toolkit/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@agent-native/toolkit/ui/tooltip";
import { IconPlus } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import { EmbeddedExtension } from "./EmbeddedExtension.js";
import { ExtensionQueryErrorState } from "./ExtensionQueryErrorState.js";
import {
  useSlotExtensions,
  useSlotInstallActions,
  useSlotInstalls,
} from "./slot-installs.js";

export interface ExtensionSlotProps {
  id: string;
  context?: Record<string, unknown> | null;
  showEmptyAffordance?: boolean;
  className?: string;
  toolClassName?: string;
  onReady?: () => void;
}

export function ExtensionSlot({
  id,
  context,
  showEmptyAffordance,
  className,
  toolClassName,
  onReady,
}: ExtensionSlotProps) {
  const t = useT();
  const readyInstallIds = useRef(new Set<string>());
  const readyNotified = useRef(false);
  const afterPaint = useAfterPaint();
  const installsQuery = useSlotInstalls(id, { enabled: afterPaint });
  const installs = installsQuery.data ?? [];
  const installsSettled = afterPaint && !installsQuery.isPending;

  useEffect(() => {
    readyInstallIds.current.clear();
    readyNotified.current = false;
  }, [id]);

  useEffect(() => {
    if (readyNotified.current || !installsSettled) return;
    if (
      installsQuery.isError ||
      installs.length === 0 ||
      readyInstallIds.current.size >= installs.length
    ) {
      readyNotified.current = true;
      onReady?.();
    }
  }, [installs, installsQuery.isError, installsSettled, onReady]);

  const markInstallReady = (installId: string) => {
    readyInstallIds.current.add(installId);
    if (
      !readyNotified.current &&
      installsSettled &&
      readyInstallIds.current.size >= installs.length
    ) {
      readyNotified.current = true;
      onReady?.();
    }
  };

  if (!installsSettled) {
    return null;
  }

  if (installsQuery.isError) {
    return (
      <ExtensionQueryErrorState
        compact
        className={className}
        message={t("extensions.widgetsLoadError")}
        onRetry={() => void installsQuery.refetch()}
        retrying={installsQuery.isFetching}
      />
    );
  }

  if (installs.length === 0) {
    if (!showEmptyAffordance) return null;
    return (
      <div className={className}>
        <SlotEmptyAffordance slotId={id} />
      </div>
    );
  }

  return (
    <div className={className}>
      {installs.map((install) => (
        <EmbeddedExtension
          key={install.installId}
          extensionId={install.extensionId}
          slotId={id}
          context={context}
          className={toolClassName}
          onReady={() => markInstallReady(install.installId)}
          onUnavailable={() => markInstallReady(install.installId)}
        />
      ))}
    </div>
  );
}

function SlotEmptyAffordance({ slotId }: { slotId: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const availableQuery = useSlotExtensions(slotId, { enabled: open });
  const available = availableQuery.data ?? [];
  const slotActions = useSlotInstallActions(slotId);

  const install = (extensionId: string) => {
    const extension = available.find((t) => t.extensionId === extensionId);
    setOpen(false);
    if (extension) void slotActions.install(extension);
  };

  const requestNew = () => {
    setOpen(false);
    sendToAgentChat({
      message: t("extensions.createWidgetPrompt", { slotId }),
      submit: false,
      openSidebar: true,
    });
  };
  const slotDescription = describeSlot(slotId, t);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-4 py-2 text-[11px] text-muted-foreground/60 hover:text-muted-foreground cursor-pointer"
              >
                <div className="h-5 w-5 rounded-md border border-dashed border-border/40 flex items-center justify-center shrink-0">
                  <IconPlus className="h-3 w-3" />
                </div>
                <span>{t("extensions.addWidget")}</span>
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>{t("extensions.addWidget")}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent
        side="left"
        align="end"
        sideOffset={8}
        className="w-72 p-0 overflow-hidden"
      >
        <div className="px-3 py-2 border-b border-border/40">
          <p className="text-[12px] font-medium">{slotDescription.title}</p>
          <p className="text-[11px] text-muted-foreground/70">
            {slotDescription.description}
          </p>
        </div>
        <div className="max-h-72 overflow-y-auto py-1">
          {availableQuery.isLoading && (
            <div className="px-3 py-3 text-[12px] text-muted-foreground/60">
              {t("extensions.loading")}
            </div>
          )}
          {availableQuery.isError && (
            <ExtensionQueryErrorState
              compact
              message={t("extensions.widgetsLoadError")}
              onRetry={() => void availableQuery.refetch()}
              retrying={availableQuery.isFetching}
            />
          )}
          {!availableQuery.isLoading &&
            !availableQuery.isError &&
            available.length === 0 && (
              <div className="px-3 py-3 text-[12px] text-muted-foreground/60">
                {t("extensions.noWidgetsAvailable")}
              </div>
            )}
          {available.map((extension) => (
            <button
              key={extension.extensionId}
              type="button"
              onClick={() => install(extension.extensionId)}
              className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-accent cursor-pointer"
            >
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium truncate">
                  {extension.name}
                </p>
                {extension.description && (
                  <p className="text-[11px] text-muted-foreground/70 truncate">
                    {extension.description}
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
        <div className="border-t border-border/40 p-1">
          <button
            type="button"
            onClick={requestNew}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
          >
            <IconPlus className="h-3.5 w-3.5" />
            <span>{t("extensions.buildNewWidget")}</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function describeSlot(
  slotId: string,
  t: ReturnType<typeof useT>,
): { title: string; description: string } {
  if (slotId === "mail.contact-sidebar.bottom") {
    return {
      title: t("extensions.contactSidebarWidget"),
      description: t("extensions.contactSidebarDescription"),
    };
  }

  if (slotId === "calendar.event-detail.bottom") {
    return {
      title: t("extensions.eventDetailWidget"),
      description: t("extensions.eventDetailDescription"),
    };
  }

  return {
    title: t("extensions.addWidgetHere"),
    description: slotId,
  };
}
