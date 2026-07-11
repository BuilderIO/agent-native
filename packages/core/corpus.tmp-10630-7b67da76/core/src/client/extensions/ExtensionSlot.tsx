import { IconPlus } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { sendToAgentChat } from "../agent-chat.js";
import { agentNativePath } from "../api-path.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { useT } from "../i18n.js";
import { EmbeddedExtension } from "./EmbeddedExtension.js";
import { ExtensionQueryErrorState } from "./ExtensionQueryErrorState.js";

interface SlotInstall {
  installId: string;
  extensionId: string;
  name: string;
  description: string;
  icon: string | null;
  updatedAt: string;
  position: number;
  config: string | null;
}

interface AvailableTool {
  extensionId: string;
  name: string;
  description: string;
  icon: string | null;
  config: string | null;
}

export interface ExtensionSlotProps {
  /** Stable slot identifier — convention: `<app>.<area>.<position>`. */
  id: string;
  /** Object pushed to each embedded extension as `slotContext`. */
  context?: Record<string, unknown> | null;
  /** Show a small "+" affordance when the slot has no installs. Default: false. */
  showEmptyAffordance?: boolean;
  /** Optional className applied to the wrapper. */
  className?: string;
  /** Optional className applied to each EmbeddedExtension. */
  toolClassName?: string;
}

/**
 * A named UI slot that user-installed extensions can render into. Apps drop this
 * component wherever they want to allow extensions; the framework handles
 * fetching, sandboxing, context delivery, and lifecycle.
 *
 * Example:
 *
 *   <ExtensionSlot
 *     id="mail.contact-sidebar.bottom"
 *     context={{ contactEmail }}
 *     showEmptyAffordance
 *   />
 */
export function ExtensionSlot({
  id,
  context,
  showEmptyAffordance,
  className,
  toolClassName,
}: ExtensionSlotProps) {
  const t = useT();
  const installsQuery = useQuery<SlotInstall[]>({
    queryKey: ["slot-installs", id],
    queryFn: async () => {
      const res = await fetch(
        agentNativePath(
          `/_agent-native/slots/${encodeURIComponent(id)}/installs`,
        ),
      );
      if (!res.ok)
        throw new Error(`Failed to load slot installs (${res.status})`);
      return res.json();
    },
  });
  const installs = installsQuery.data ?? [];

  if (installsQuery.isLoading) {
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
        />
      ))}
    </div>
  );
}

function SlotEmptyAffordance({ slotId }: { slotId: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const availableQuery = useQuery<AvailableTool[]>({
    queryKey: ["slot-available", slotId],
    queryFn: async () => {
      const res = await fetch(
        agentNativePath(
          `/_agent-native/slots/${encodeURIComponent(slotId)}/available`,
        ),
      );
      if (!res.ok) {
        throw new Error(`Failed to load available extensions (${res.status})`);
      }
      return res.json();
    },
    enabled: open,
  });
  const available = availableQuery.data ?? [];
  const queryClient = useQueryClient();

  const install = async (extensionId: string) => {
    queryClient.setQueryData<SlotInstall[]>(
      ["slot-installs", slotId],
      (old) => {
        const extension = available.find((t) => t.extensionId === extensionId);
        if (!extension || !old) return old;
        return [
          ...old,
          {
            installId: `optimistic-${extensionId}`,
            extensionId,
            name: extension.name,
            description: extension.description,
            icon: extension.icon,
            updatedAt: new Date().toISOString(),
            position: old.length,
            config: extension.config,
          },
        ];
      },
    );
    setOpen(false);
    try {
      await fetch(
        agentNativePath(
          `/_agent-native/slots/${encodeURIComponent(slotId)}/install`,
        ),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ extensionId }),
        },
      );
    } finally {
      queryClient.invalidateQueries({ queryKey: ["slot-installs", slotId] });
    }
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
