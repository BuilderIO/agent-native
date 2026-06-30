// i18n-raw-literal-disable-file — new Design Studio panel; UI strings are localized when this feature is finalized in the follow-up PR.
import {
  PromptComposer,
  agentNativePath,
  sendToAgentChat,
  useActionMutation,
  useChangeVersions,
  useT,
  type PromptComposerProps,
  type PromptComposerSubmitOptions,
} from "@agent-native/core/client";
import { EmbeddedExtension } from "@agent-native/core/client/extensions";
import {
  EmbeddedApp,
  type EmbeddedAppRef,
} from "@agent-native/core/embedding/react";
import type { ShaderDescriptor } from "@shared/shader-presets";
import {
  IconExternalLink,
  IconLock,
  IconPalette,
  IconPhoto,
  IconPlayerPlay,
  IconPlus,
  IconPuzzle,
  IconSparkles,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

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

import { ShaderFillsPanel } from "./inspector/ShaderFillsPanel";
import type { ElementInfo } from "./types";

export const DESIGN_EDITOR_EXTENSION_SLOT_ID = "design.editor.inspector";

// ─── Types ──────────────────────────────────────────────────────────────────

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

// ─── First-party extension ids ───────────────────────────────────────────────

type FirstPartyExtId =
  | "design.asset-library"
  | "design.shader-fills"
  | "design.token-auditor"
  | "design.motion-presets";

// ─── Assets picker types (mirrors PromptDialog) ───────────────────────────

const DEFAULT_ASSETS_PICKER_URL = "https://assets.agent-native.com/picker";

interface PickedAssetPayload {
  url?: unknown;
  previewUrl?: unknown;
  downloadUrl?: unknown;
  embedUrl?: unknown;
  altText?: unknown;
  title?: unknown;
  assetId?: unknown;
  mimeType?: unknown;
}

function assetsPickerUrl(): string {
  return (
    (typeof import.meta !== "undefined" &&
      (import.meta as { env?: Record<string, string> }).env
        ?.VITE_AGENT_NATIVE_ASSETS_PICKER_URL) ||
    DEFAULT_ASSETS_PICKER_URL
  );
}

function pickedAssetString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function pickedAssetImageSource(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as PickedAssetPayload;
  return (
    pickedAssetString(p.url) ??
    pickedAssetString(p.previewUrl) ??
    pickedAssetString(p.downloadUrl) ??
    pickedAssetString(p.embedUrl)
  );
}

// ─── Build extension create context ──────────────────────────────────────────

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

// ─── Hooks ───────────────────────────────────────────────────────────────────

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

// ─── First-party extension rows ───────────────────────────────────────────────

interface FirstPartyRowProps {
  id: FirstPartyExtId;
  label: string;
  description: string;
  icon: React.ReactNode;
  badge?: React.ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function FirstPartyExtRow({
  label,
  description,
  icon,
  badge,
  isOpen,
  onToggle,
  children,
}: FirstPartyRowProps) {
  return (
    <div className="overflow-hidden rounded border border-border bg-background">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center gap-2 px-2.5 py-2 text-left transition-colors hover:bg-accent/50 active:bg-accent"
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11px] font-medium text-foreground">
            {label}
          </span>
          <span className="block truncate text-[10px] leading-tight text-muted-foreground">
            {description}
          </span>
        </span>
        {badge}
      </button>
      {isOpen && <div className="border-t border-border/60">{children}</div>}
    </div>
  );
}

// ─── Asset Library panel ──────────────────────────────────────────────────────

interface AssetLibraryPanelProps {
  context: DesignExtensionSlotContext;
}

function AssetLibraryPanel({ context }: AssetLibraryPanelProps) {
  const t = useT();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerReady, setPickerReady] = useState(false);
  const insertAsset = useActionMutation("insert-asset");

  useEffect(() => {
    if (pickerOpen) setPickerReady(false);
  }, [pickerOpen]);

  const handleReady = useCallback(
    (_payload: unknown, _event: MessageEvent, ref: EmbeddedAppRef) => {
      setPickerReady(true);
      ref.postMessage("configure", {});
    },
    [],
  );

  const handleMessage = useCallback(
    (name: string, payload: unknown) => {
      if (name === "close") {
        setPickerOpen(false);
        return;
      }
      if (name !== "chooseImage" && name !== "chooseAsset") return;

      const url = pickedAssetImageSource(payload);
      if (!url) {
        toast.error("No image URL returned from Assets picker.");
        return;
      }

      const p = payload as PickedAssetPayload;
      const title = pickedAssetString(p.title) ?? undefined;
      const altText = pickedAssetString(p.altText) ?? undefined;
      const assetId = pickedAssetString(p.assetId) ?? undefined;
      const mimeType = pickedAssetString(p.mimeType) ?? "";
      const mediaType = mimeType.startsWith("video/") ? "video" : "image";

      insertAsset.mutate(
        {
          assetUrl: url,
          assetId,
          title,
          altText,
          mediaType: mediaType as "image" | "video",
          designId: context.designId || undefined,
          fileId: context.activeFileId || undefined,
        },
        {
          onSuccess: () => {
            toast.success("Asset inserted into design.");
          },
          onError: () => {
            toast.error("Failed to insert asset.");
          },
        },
      );

      setPickerOpen(false);
    },
    [context.designId, context.activeFileId, insertAsset],
  );

  const handleAskAgent = () => {
    sendToAgentChat({
      message:
        "Open the Assets picker so I can choose an image to insert into the design.",
      context: [
        `Design id: ${context.designId}`,
        context.activeFileId ? `Active file id: ${context.activeFileId}` : null,
        context.selectedElement?.selector
          ? `Selected element selector: ${context.selectedElement.selector}`
          : null,
        "Call insert-asset with the chosen URL after the user picks from the Assets picker.",
      ]
        .filter(Boolean)
        .join("\n"),
      submit: true,
      openSidebar: true,
    });
  };

  return (
    <div className="p-2.5">
      <p className="mb-2 text-[10px] leading-snug text-muted-foreground">
        Browse and insert generated or uploaded images into the active design
        screen. Inserts near the selected element when one is active.
      </p>
      <div className="flex flex-wrap gap-1.5">
        <Button
          type="button"
          size="sm"
          className="h-6 cursor-pointer gap-1 px-2 text-[11px]"
          disabled={insertAsset.isPending || !context.activeFileId}
          onClick={() => setPickerOpen(true)}
        >
          <IconPhoto className="size-3" />
          {insertAsset.isPending ? "Inserting…" : "Browse Assets"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-6 cursor-pointer gap-1 px-2 text-[11px]"
          onClick={handleAskAgent}
        >
          <IconSparkles className="size-3" />
          {t("designEditor.askAgent") || "Ask agent"}
        </Button>
      </div>
      {!context.activeFileId && (
        <p className="mt-1.5 text-[10px] text-amber-600 dark:text-amber-400">
          Open a design screen first to insert assets.
        </p>
      )}

      {/* Assets picker overlay */}
      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div
            data-assets-picker-overlay
            className="relative flex h-[min(86vh,760px)] w-[min(96vw,1040px)] flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-2xl"
          >
            <div className="flex h-10 shrink-0 items-center border-b border-border px-4">
              <span className="flex-1 text-sm font-medium">Assets Library</span>
              <button
                type="button"
                aria-label="Close picker"
                onClick={() => setPickerOpen(false)}
                className="flex size-7 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                ×
              </button>
            </div>
            <div className="relative min-h-0 flex-1">
              {!pickerReady && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Skeleton className="h-full w-full rounded-none" />
                </div>
              )}
              <EmbeddedApp
                url={assetsPickerUrl()}
                title="Assets picker"
                onReady={handleReady}
                onMessage={handleMessage}
                className="h-full w-full"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Shader Fills panel ───────────────────────────────────────────────────────

interface ShaderFillsExtPanelProps {
  context: DesignExtensionSlotContext;
}

function ShaderFillsExtPanel({ context }: ShaderFillsExtPanelProps) {
  const [showShaders, setShowShaders] = useState(false);
  // The most recently previewed descriptor — Apply persists exactly this one,
  // so the write is intentional (one atomic call) rather than firing on every
  // slider tweak.
  const [previewed, setPreviewed] = useState<ShaderDescriptor | null>(null);
  const applyShaderFill = useActionMutation("apply-shader-fill");

  // The persisting apply path needs an HTML file plus a target element. Without
  // a selected element we can still preview, but we cannot write a fill.
  const targetNodeId = context.selectedElement?.sourceId ?? undefined;
  const targetSelector = context.selectedElement?.selector ?? undefined;
  const canPersist = Boolean(
    context.activeFileId && (targetNodeId || targetSelector),
  );

  const persistFill = (descriptor: ShaderDescriptor) => {
    if (!canPersist) return;
    applyShaderFill.mutate(
      {
        descriptor: {
          preset: descriptor.preset,
          params: descriptor.params,
          colors: descriptor.colors,
          speed: descriptor.speed,
          frame: descriptor.frame,
          fit: descriptor.fit,
          scale: descriptor.scale,
          rotation: descriptor.rotation,
          offsetX: descriptor.offsetX,
          offsetY: descriptor.offsetY,
        },
        target: { nodeId: targetNodeId, selector: targetSelector },
        source: {
          kind: "design-file" as const,
          designId: context.designId || undefined,
          fileId: context.activeFileId || undefined,
        },
      },
      {
        onSuccess: (res) => {
          const r = res as { persisted?: boolean } | undefined;
          if (r?.persisted) {
            toast.success("Shader fill applied to the selected element.");
          } else {
            toast.message("Shader fill previewed — nothing was written.");
          }
        },
        onError: () => {
          toast.error("Failed to apply shader fill.");
        },
      },
    );
  };

  if (!showShaders) {
    return (
      <div className="p-2.5">
        <p className="mb-2 text-[10px] leading-snug text-muted-foreground">
          GPU shader fill presets — MeshGradient, GrainGradient, Voronoi,
          Metaballs, Warp, GodRays, Dithering, PaperTexture. Preview as a CSS
          gradient, then apply it to the selected element as a CSS background.
        </p>
        {!canPersist && (
          <div className="mb-2 flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1.5">
            <IconLock className="mt-0.5 size-3 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-[10px] leading-snug text-amber-700 dark:text-amber-300">
              Select an element on the canvas to apply a fill. Without a
              selection you can still browse and preview presets.
            </p>
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            size="sm"
            className="h-6 cursor-pointer gap-1 px-2 text-[11px]"
            onClick={() => setShowShaders(true)}
          >
            <IconSparkles className="size-3" />
            Browse Shaders
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <ShaderFillsPanel
        onApply={(descriptor, _css) => {
          // Preview only: ShaderFillsPanel fires apply-shader (planning/codegen)
          // for agent context on every tune and the iframe shows the gradient.
          // We just record the latest descriptor here; the explicit Apply
          // button below performs the single intentional persist write.
          setPreviewed(descriptor);
        }}
        onBack={() => setShowShaders(false)}
        applyContext={{
          designId: context.designId || undefined,
          fileId: context.activeFileId || undefined,
          nodeId: targetNodeId,
          selector: targetSelector,
        }}
      />

      {/* ── Apply bar: persists the previewed fill onto the selected element ── */}
      <div className="flex items-center gap-2 border-t border-border/60 px-3 py-2">
        {canPersist ? (
          <Button
            type="button"
            size="sm"
            className="h-6 cursor-pointer gap-1 px-2 text-[11px]"
            disabled={!previewed || applyShaderFill.isPending}
            onClick={() => {
              if (previewed) persistFill(previewed);
            }}
          >
            <IconSparkles className="size-3" />
            {applyShaderFill.isPending
              ? "Applying…"
              : previewed
                ? "Apply fill"
                : "Pick a preset"}
          </Button>
        ) : (
          <p className="flex items-start gap-1.5 text-[10px] leading-snug text-amber-700 dark:text-amber-300">
            <IconLock className="mt-0.5 size-3 shrink-0 text-amber-600 dark:text-amber-400" />
            Select an element on the canvas to apply this fill.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Token Auditor panel ─────────────────────────────────────────────────────

interface TokenAuditorPanelProps {
  context: DesignExtensionSlotContext;
}

function TokenAuditorPanel({ context }: TokenAuditorPanelProps) {
  const t = useT();

  const handleAskAgent = () => {
    sendToAgentChat({
      message:
        "Run a token audit on the active design: index CSS custom properties, surface any hard-coded colours that should be tokens, flag clashes, and suggest fixes.",
      context: [
        `Design id: ${context.designId}`,
        context.activeFileId ? `Active file id: ${context.activeFileId}` : null,
        "Call index-design-tokens to parse CSS vars, then preview-design-token-edit for suggested changes.",
      ]
        .filter(Boolean)
        .join("\n"),
      submit: true,
      openSidebar: true,
    });
  };

  return (
    <div className="p-2.5">
      <p className="mb-2 text-[10px] leading-snug text-muted-foreground">
        Index CSS custom property usage across the active design, surface
        hard-coded colours that should be tokens, and flag clashes.
      </p>
      <div className="mb-1.5 text-[10px] text-muted-foreground">
        Token reads and tweaks are available for all source types. Source
        write-back (globals.css / tailwind.config) is gated on bridge hardening.
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button
          type="button"
          size="sm"
          className="h-6 cursor-pointer gap-1 px-2 text-[11px]"
          onClick={handleAskAgent}
        >
          <IconSparkles className="size-3" />
          {t("designEditor.askAgent") || "Ask agent"}
        </Button>
      </div>
    </div>
  );
}

// ─── Motion Presets panel ─────────────────────────────────────────────────────

interface MotionPresetsPanelProps {
  context: DesignExtensionSlotContext;
}

function MotionPresetsPanel({ context }: MotionPresetsPanelProps) {
  const t = useT();

  const handleAskAgent = () => {
    sendToAgentChat({
      message:
        "Apply a motion preset to the selected element. Suggest fade-in, slide-up, pulse, bounce, or spin, then call apply-motion-edit to write the keyframes atomically.",
      context: [
        `Design id: ${context.designId}`,
        context.activeFileId ? `Active file id: ${context.activeFileId}` : null,
        context.selectedElement
          ? `Selected element: ${JSON.stringify({ selector: context.selectedElement.selector, sourceId: context.selectedElement.sourceId }, null, 2)}`
          : "No element selected — ask the user to click an element first.",
        "Call get-motion-timeline to check for an existing timeline, then preview-motion-frame first, then apply-motion-edit for the atomic write.",
      ]
        .filter(Boolean)
        .join("\n"),
      submit: true,
      openSidebar: true,
    });
  };

  return (
    <div className="p-2.5">
      <p className="mb-2 text-[10px] leading-snug text-muted-foreground">
        One-click animation presets — fade-in, slide-up, pulse, bounce, spin —
        applied to the selected element via the motion timeline.
      </p>
      {!context.selectedElement && (
        <p className="mb-1.5 text-[10px] text-muted-foreground">
          Select an element on the canvas first, then ask the agent to apply a
          motion preset.
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        <Button
          type="button"
          size="sm"
          className="h-6 cursor-pointer gap-1 px-2 text-[11px]"
          onClick={handleAskAgent}
        >
          <IconSparkles className="size-3" />
          {t("designEditor.askAgent") || "Ask agent"}
        </Button>
      </div>
    </div>
  );
}

// ─── Main panel ──────────────────────────────────────────────────────────────

export function DesignExtensionsPanel({
  context,
  className,
}: DesignExtensionsPanelProps) {
  const t = useT();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [openFirstParty, setOpenFirstParty] = useState<FirstPartyExtId | null>(
    null,
  );
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

  const toggleFirstParty = (id: FirstPartyExtId) => {
    setOpenFirstParty((prev) => (prev === id ? null : id));
  };

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
      const res = await fetch(
        agentNativePath(
          `/_agent-native/slots/${encodeURIComponent(slotId)}/install`,
        ),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ extensionId }),
        },
      );
      if (!res.ok) throw new Error(`Install failed: ${res.status}`);
      queryClient.invalidateQueries({
        queryKey: ["design-editor-extension-slot"],
      });
      queryClient.invalidateQueries({
        queryKey: ["design-editor-extension-slot-available"],
      });
    } catch {
      toast.error(t("designEditor.extensionsInstallError"));
    } finally {
      setInstallingId(null);
    }
  };

  // First-party extension row config
  const firstPartyRows: Array<{
    id: FirstPartyExtId;
    label: string;
    description: string;
    icon: React.ReactNode;
    badge?: React.ReactNode;
    panel: React.ReactNode;
  }> = [
    {
      id: "design.asset-library",
      label: "Asset Library",
      description: "Browse & insert assets into the active screen",
      icon: <IconPhoto className="size-3.5" />,
      panel: <AssetLibraryPanel context={context} />,
    },
    {
      id: "design.shader-fills",
      label: "Shader Fills",
      description: "GPU shader fill presets — preview & apply",
      icon: <IconSparkles className="size-3.5" />,
      panel: <ShaderFillsExtPanel context={context} />,
    },
    {
      id: "design.token-auditor",
      label: "Token Auditor",
      description: "Audit CSS token usage, flag clashes",
      icon: <IconPalette className="size-3.5" />,
      panel: <TokenAuditorPanel context={context} />,
    },
    {
      id: "design.motion-presets",
      label: "Motion Presets",
      description: "One-click animation presets for elements",
      icon: <IconPlayerPlay className="size-3.5" />,
      panel: <MotionPresetsPanel context={context} />,
    },
  ];

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      {/* Section header — 32 px tall, matches PanelSection / design inspector headers */}
      <div className="flex min-h-8 shrink-0 items-center gap-1.5 border-b border-border/60 px-3">
        <h3 className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
          {t("designEditor.extensions")}
        </h3>
        <Tooltip>
          <TooltipTrigger asChild>
            <a
              href="https://www.agent-native.com/docs/extensions"
              target="_blank"
              rel="noreferrer"
              className="inline-flex size-6 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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

      <div className="design-inspector-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-2 pt-1.5">
        {/* ── First-party built-in extensions ──────────────────────────── */}
        <div className="mb-3 space-y-1">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Built-in
          </p>
          {firstPartyRows.map((row) => (
            <FirstPartyExtRow
              key={row.id}
              id={row.id}
              label={row.label}
              description={row.description}
              icon={row.icon}
              badge={row.badge}
              isOpen={openFirstParty === row.id}
              onToggle={() => toggleFirstParty(row.id)}
            >
              {row.panel}
            </FirstPartyExtRow>
          ))}
        </div>

        {/* ── Agent help text ───────────────────────────────────────────── */}
        <div className="mb-3 flex items-start gap-1.5 rounded-md bg-muted/40 px-2 py-1.5">
          <IconSparkles className="mt-0.5 size-3 shrink-0 text-muted-foreground/70" />
          <p className="text-[10px] leading-snug text-muted-foreground">
            The agent can insert assets, apply shader fills, audit tokens, and
            apply motion presets. Ask in the chat sidebar for help.
          </p>
        </div>

        {/* ── User-installed extensions ──────────────────────────────────── */}
        {isLoading ? (
          <div className="space-y-1.5">
            <Skeleton className="h-24 rounded" />
            <Skeleton className="h-32 rounded" />
          </div>
        ) : installs.length > 0 ? (
          <div className="space-y-1.5">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Installed
            </p>
            {installs.map((install) => (
              <EmbeddedExtension
                key={install.installId}
                extensionId={install.extensionId}
                slotId={slotId}
                context={context}
                initialHeight={180}
                className="overflow-hidden rounded border border-border bg-background"
              />
            ))}
          </div>
        ) : (
          /* Empty state for user extensions — compact */
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <div className="flex size-7 items-center justify-center rounded-lg bg-muted/60">
              <IconPuzzle className="size-3.5 text-muted-foreground/70" />
            </div>
            <div>
              <p className="text-[11px] font-medium text-foreground">
                {t("designEditor.extensionsEmptyTitle")}
              </p>
              <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
                {t("designEditor.extensionsEmptyDescription")}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              className="h-6 cursor-pointer px-2.5 text-[11px]"
              onClick={() => setCreateOpen(true)}
            >
              <IconPlus className="size-3" />
              {t("designEditor.addExtension")}
            </Button>
          </div>
        )}

        {/* ── Available (installable) extensions ────────────────────────── */}
        {installable.length > 0 ? (
          <div className="mt-3 border-t border-border/60 pt-1.5">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("designEditor.extensionsAvailable")}
            </p>
            <div className="space-y-px">
              {installable.map((extension) => (
                <button
                  key={extension.extensionId}
                  type="button"
                  disabled={installingId === extension.extensionId}
                  onClick={() => installExtension(extension.extensionId)}
                  className="flex h-6 w-full cursor-pointer items-center gap-1.5 rounded px-2 text-left transition-colors hover:bg-accent active:bg-accent/80 disabled:cursor-default disabled:opacity-50"
                >
                  <IconSparkles className="size-3 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">
                    {extension.name}
                  </span>
                  {extension.description ? (
                    <span className="hidden truncate text-[11px] text-muted-foreground sm:block">
                      {extension.description}
                    </span>
                  ) : null}
                  <span className="shrink-0 text-[11px] text-muted-foreground">
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

// ─── Create extension popover ─────────────────────────────────────────────────

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
              className="size-6 rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
