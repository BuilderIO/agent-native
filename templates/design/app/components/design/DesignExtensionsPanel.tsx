import {
  PromptComposer,
  agentNativePath,
  sendToAgentChat,
  useChangeVersions,
  useT,
  type PromptComposerProps,
  type PromptComposerSubmitOptions,
} from "@agent-native/core/client";
import { EmbeddedExtension } from "@agent-native/core/client/extensions";
import {
  IconExternalLink,
  IconPlus,
  IconPuzzle,
  IconSparkles,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { ElementInfo } from "./types";

export const DESIGN_EDITOR_EXTENSION_SLOT_ID = "design.editor.inspector";

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

interface AvailableExtension {
  extensionId: string;
  name: string;
  description: string;
  icon: string | null;
  config: string | null;
}

export interface DesignExtensionSlotContext extends Record<string, unknown> {
  designId: string;
  designTitle: string | null;
  activeFileId: string | null;
  activeFilename: string | null;
  viewMode: "single" | "overview";
  zoom: number;
  screens: Array<{
    id: string;
    filename: string;
    fileType?: string | null;
  }>;
  selectedScreenIds: string[];
  selectedElement: ElementInfo | null;
  mode: string;
  activeTool: string;
  tweakValues: Record<string, string | number | boolean>;
}

interface DesignExtensionsPanelProps {
  context: DesignExtensionSlotContext;
  className?: string;
}

type PromptComposerSubmitHandler = PromptComposerProps["onSubmit"];

function buildExtensionCreateContext(
  prompt: string,
  context: DesignExtensionSlotContext,
): string {
  const selectedElement = context.selectedElement
    ? JSON.stringify(context.selectedElement, null, 2)
    : "No element is currently selected.";
  return [
    `The user is in the Design editor Extensions inspector for design id "${context.designId}"${context.designTitle ? ` (title: "${context.designTitle}")` : ""}.`,
    context.activeFileId
      ? `Active screen: "${context.activeFilename ?? context.activeFileId}" (file id: "${context.activeFileId}").`
      : "There is no active screen yet.",
    `Create a persisted extension for the Design editor inspector slot "${DESIGN_EDITOR_EXTENSION_SLOT_ID}".`,
    `User request: "${prompt}"`,
    "",
    "After create-extension succeeds, call add-extension-slot-target with this slot id, then install-extension with this slot id so the extension appears in the editor panel immediately.",
    'If create-extension opens the standalone extension editor, call navigate with view "editor", the current design id, and inspectorTab "extensions" after install so the user returns to this inline panel.',
    "",
    "The extension will receive window.slotContext and onSlotContext updates with the current design selection:",
    JSON.stringify(
      {
        designId: context.designId,
        designTitle: context.designTitle,
        activeFileId: context.activeFileId,
        activeFilename: context.activeFilename,
        viewMode: context.viewMode,
        zoom: context.zoom,
        screens: context.screens,
        selectedScreenIds: context.selectedScreenIds,
        mode: context.mode,
        activeTool: context.activeTool,
        tweakValues: context.tweakValues,
      },
      null,
      2,
    ),
    "",
    "Current selected element:",
    selectedElement,
    "",
    "Design extension behavior guidelines:",
    "- Use appAction() for reads and deterministic app actions when appropriate.",
    "- Use agentNative.chat.send(message, { context }) for AI-driven style, copy, layout, or artboard changes.",
    "- When sending a prompt to the agent, include designId, activeFileId or activeFilename, selectedElement.selector, selectedElement.sourceId, and the requested change.",
    "- Tell the agent to call view-screen first, then prefer apply-visual-edit for selected element style/class/text/move changes.",
    "- Use update-design or generate-design with canvasFrames for overview artboard placement changes.",
    "- Keep the extension compact enough for a right-side inspector panel and use semantic Tailwind colors.",
  ].join("\n");
}

function useSlotInstalls(slotId: string) {
  const versions = useChangeVersions(["action"]);
  return useQuery<SlotInstall[]>({
    queryKey: ["design-editor-extension-slot", slotId, versions],
    queryFn: async () => {
      const res = await fetch(
        agentNativePath(
          `/_agent-native/slots/${encodeURIComponent(slotId)}/installs`,
        ),
      );
      if (!res.ok) return [];
      return res.json();
    },
    placeholderData: (prev) => prev,
  });
}

function useAvailableExtensions(slotId: string) {
  const versions = useChangeVersions(["action"]);
  return useQuery<AvailableExtension[]>({
    queryKey: ["design-editor-extension-slot-available", slotId, versions],
    queryFn: async () => {
      const res = await fetch(
        agentNativePath(
          `/_agent-native/slots/${encodeURIComponent(slotId)}/available`,
        ),
      );
      if (!res.ok) return [];
      return res.json();
    },
    placeholderData: (prev) => prev,
  });
}

export function DesignExtensionsPanel({
  context,
  className,
}: DesignExtensionsPanelProps) {
  const t = useT();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const slotId = DESIGN_EDITOR_EXTENSION_SLOT_ID;
  const { data: installs = [], isLoading } = useSlotInstalls(slotId);
  const { data: available = [] } = useAvailableExtensions(slotId);
  const installedIds = useMemo(
    () => new Set(installs.map((install) => install.extensionId)),
    [installs],
  );
  const installable = available.filter(
    (extension) => !installedIds.has(extension.extensionId),
  );

  const submitCreatePrompt: PromptComposerSubmitHandler = (
    text: string,
    _files,
    _references,
    options: PromptComposerSubmitOptions,
  ) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    sendToAgentChat({
      message: `Create a Design extension: ${trimmed}`,
      context: buildExtensionCreateContext(trimmed, context),
      submit: true,
      openSidebar: true,
      newTab: true,
      model: options.model,
      engine: options.engine,
      effort: options.effort,
    });
    setCreateOpen(false);
  };

  const installExtension = async (extensionId: string) => {
    setInstallingId(extensionId);
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
      setInstallingId(null);
      queryClient.invalidateQueries({
        queryKey: ["design-editor-extension-slot"],
      });
      queryClient.invalidateQueries({
        queryKey: ["design-editor-extension-slot-available"],
      });
    }
  };

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border/90 px-3">
        <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">
          {t("designEditor.extensions")}
        </h3>
        <Tooltip>
          <TooltipTrigger asChild>
            <a
              href="https://www.agent-native.com/docs/extensions"
              target="_blank"
              rel="noreferrer"
              className="inline-flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={t("designEditor.extensionsDocs")}
            >
              <IconExternalLink className="size-3.5" />
            </a>
          </TooltipTrigger>
          <TooltipContent>{t("designEditor.extensionsDocs")}</TooltipContent>
        </Tooltip>
        <CreateExtensionPopover
          open={createOpen}
          onOpenChange={setCreateOpen}
          onSubmit={submitCreatePrompt}
        />
      </div>

      <div className="design-inspector-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-32 rounded-lg" />
          </div>
        ) : installs.length === 0 ? (
          <div className="flex min-h-[18rem] flex-col items-center justify-center rounded-lg border border-dashed border-border/80 bg-muted/20 px-3 py-8 text-center">
            <div className="mb-3 flex size-10 items-center justify-center rounded-lg border border-border/70 bg-background text-muted-foreground">
              <IconPuzzle className="size-5" />
            </div>
            <p className="text-sm font-semibold text-foreground">
              {t("designEditor.extensionsEmptyTitle")}
            </p>
            <p className="mt-1 max-w-[14rem] text-xs leading-relaxed text-muted-foreground">
              {t("designEditor.extensionsEmptyDescription")}
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <Button
                type="button"
                size="sm"
                className="h-8 cursor-pointer text-xs"
                onClick={() => setCreateOpen(true)}
              >
                <IconPlus className="size-3.5" />
                {t("designEditor.addExtension")}
              </Button>
              <Button
                asChild
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 cursor-pointer text-xs"
              >
                <a
                  href="https://www.agent-native.com/docs/extensions"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("designEditor.extensionsDocs")}
                </a>
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {installs.map((install) => (
              <EmbeddedExtension
                key={install.installId}
                extensionId={install.extensionId}
                slotId={slotId}
                context={context}
                initialHeight={180}
                className="overflow-hidden rounded-lg border border-border bg-background"
              />
            ))}
          </div>
        )}

        {installable.length > 0 ? (
          <div className="mt-4 border-t border-border/70 pt-3">
            <p className="mb-2 text-[11px] font-semibold uppercase text-muted-foreground">
              {t("designEditor.extensionsAvailable")}
            </p>
            <div className="space-y-1.5">
              {installable.map((extension) => (
                <button
                  key={extension.extensionId}
                  type="button"
                  disabled={installingId === extension.extensionId}
                  onClick={() => installExtension(extension.extensionId)}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-md border border-border/70 bg-background px-2.5 py-2 text-left hover:bg-accent disabled:cursor-default disabled:opacity-60"
                >
                  <IconSparkles className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-foreground">
                      {extension.name}
                    </span>
                    {extension.description ? (
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {extension.description}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-[11px] font-medium text-muted-foreground">
                    {t("designEditor.extensionsInstall")}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CreateExtensionPopover({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: PromptComposerSubmitHandler;
}) {
  const t = useT();
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={t("designEditor.addExtension")}
            >
              <IconPlus className="size-3.5" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("designEditor.addExtension")}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" sideOffset={6} className="w-80 p-3">
        <p className="px-1 pb-2 text-sm font-semibold text-foreground">
          {t("designEditor.extensionsPromptTitle")}
        </p>
        <PromptComposer
          autoFocus
          attachmentsEnabled={false}
          plusMenuMode="hidden"
          layoutVariant="compact"
          draftScope="design:editor-extension-create"
          placeholder={t("designEditor.extensionsPlaceholder")}
          onSubmit={onSubmit}
        />
      </PopoverContent>
    </Popover>
  );
}
