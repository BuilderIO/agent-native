import { agentNativePath } from "../api-path.js";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconPlus } from "@tabler/icons-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";
import { sendToAgentChat } from "../agent-chat.js";
import { EmbeddedExtension } from "./EmbeddedExtension.js";

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
  const { data: installs = [], isLoading } = useQuery<SlotInstall[]>({
    queryKey: ["slot-installs", id],
    queryFn: async () => {
      const res = await fetch(
        agentNativePath(
          `/_agent-native/slots/${encodeURIComponent(id)}/installs`,
        ),
      );
      if (!res.ok) return [];
      return res.json();
    },
  });

  if (isLoading) {
    return null;
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
  const [open, setOpen] = useState(false);
  const { data: available = [], isLoading } = useQuery<AvailableTool[]>({
    queryKey: ["slot-available", slotId],
    queryFn: async () => {
      const res = await fetch(
        agentNativePath(
          `/_agent-native/slots/${encodeURIComponent(slotId)}/available`,
        ),
      );
      if (!res.ok) return [];
      return res.json();
    },
    enabled: open,
  });
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
      message: `Create a new widget that fits in slot "${slotId}". I'll describe what it should do next.`,
      submit: false,
      openSidebar: true,
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 px-4 py-2 text-[11px] text-muted-foreground/60 hover:text-muted-foreground cursor-pointer"
          title="Add a widget"
        >
          <div className="h-5 w-5 rounded-md border border-dashed border-border/40 flex items-center justify-center shrink-0">
            <IconPlus className="h-3 w-3" />
          </div>
          <span>Add widget</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="left"
        align="end"
        sideOffset={8}
        className="w-72 p-0 overflow-hidden"
      >
        <div className="px-3 py-2 border-b border-border/40">
          <p className="text-[12px] font-medium">Add widget here</p>
          <p className="text-[11px] text-muted-foreground/70">{slotId}</p>
        </div>
        <div className="max-h-72 overflow-y-auto py-1">
          {isLoading && (
            <div className="px-3 py-3 text-[12px] text-muted-foreground/60">
              Loading…
            </div>
          )}
          {!isLoading && available.length === 0 && (
            <div className="px-3 py-3 text-[12px] text-muted-foreground/60">
              No widgets available for this slot yet.
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
                <p className="text-[12px] font-medium truncate">{extension.name}</p>
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
            <span>Build a new widget</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
