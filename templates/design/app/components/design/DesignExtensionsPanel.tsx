// i18n-raw-literal-disable-file — new Design Studio panel; UI strings are localized when this feature is finalized in the follow-up PR.
import {
  agentNativePath,
  useActionQuery,
  useActionMutation,
  useChangeVersions,
  useT,
} from "@agent-native/core/client";
import { EmbeddedExtension } from "@agent-native/core/client/extensions";
import {
  EmbeddedApp,
  type EmbeddedAppRef,
} from "@agent-native/core/embedding/react";
import type { ShaderDescriptor } from "@shared/shader-presets";
import {
  IconAdjustmentsHorizontal,
  IconAssembly,
  IconBrandFigma,
  IconChevronDown,
  IconExternalLink,
  IconLock,
  IconMessageCircle,
  IconPalette,
  IconPhoto,
  IconPlayerPlay,
  IconPuzzle,
  IconSearch,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { sendToDesignAgentChat } from "@/lib/agent-chat";
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
  activeFileUpdatedAt: string | null;
  activeContent: string;
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
  onShaderFillPreview?: (descriptor: ShaderDescriptor, css: string) => void;
  onShaderFillPreviewClear?: () => void;
  onShaderFillApplied?: (
    fileId: string,
    content: string,
    updatedAt?: string,
  ) => void;
}

interface DesignExtensionsPanelProps {
  context: DesignExtensionSlotContext;
  className?: string;
  hideAssetLibrary?: boolean;
  title?: string;
}

type CreateExtensionSubmitHandler = (text: string) => void;

// ─── First-party extension ids ───────────────────────────────────────────────

type FirstPartyExtId =
  | "design.asset-library"
  | "design.shader-fills"
  | "design.token-auditor"
  | "design.motion-presets";

type ToolSourceFilter = "all" | "built-in" | "extensions";
type ToolCategoryFilter = "all" | "shader" | "tokens" | "motion" | "plugins";

type FirstPartyRow = {
  id: FirstPartyExtId;
  label: string;
  description: string;
  category: ToolCategoryFilter;
  icon: React.ReactNode;
  badge?: React.ReactNode;
  panel: React.ReactNode;
};

// ─── Assets picker types (mirrors PromptDialog) ───────────────────────────

const DEFAULT_ASSETS_PICKER_URL =
  "https://assets.agent-native.com/library?__an_picker=1&mediaType=image&layout=vertical";

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
  const configured =
    (typeof import.meta !== "undefined" &&
      (import.meta as { env?: Record<string, string> }).env
        ?.VITE_AGENT_NATIVE_ASSETS_PICKER_URL) ||
    DEFAULT_ASSETS_PICKER_URL;
  try {
    const base =
      typeof window !== "undefined"
        ? window.location.origin
        : "https://assets.agent-native.com";
    const url = new URL(configured, base);
    if (url.pathname === "/picker") url.pathname = "/library";
    url.searchParams.set("__an_picker", "1");
    url.searchParams.set(
      "mediaType",
      url.searchParams.get("mediaType") || "image",
    );
    url.searchParams.set("layout", "vertical");
    url.searchParams.set("embedded", "1");
    url.searchParams.set("callerAppId", "design");
    return url.toString();
  } catch {
    return configured;
  }
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
    `The user is in the Design editor Tools panel for design id "${context.designId}"${context.designTitle ? ` (title: "${context.designTitle}")` : ""}.`,
    context.activeFileId
      ? `Active screen: "${context.activeFilename ?? context.activeFileId}" (file id: "${context.activeFileId}").`
      : "There is no active screen yet.",
    `Create a persisted extension for the Design editor inspector slot "${DESIGN_EDITOR_EXTENSION_SLOT_ID}".`,
    `User request: "${prompt}"`,
    "",
    "After create-extension succeeds, call add-extension-slot-target with this slot id, then install-extension with this slot id so the extension appears in the editor panel immediately.",
    'If create-extension opens the standalone extension editor, call navigate with view "editor", the current design id, and leftPanel "tools" after install so the user returns to this inline panel.',
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
  icon,
  badge,
  isOpen,
  onToggle,
  children,
}: FirstPartyRowProps) {
  return (
    <div className="overflow-hidden rounded-md">
      <button
        type="button"
        onClick={onToggle}
        className="group flex w-full cursor-pointer items-center gap-3 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-accent/60 active:bg-accent"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/70 text-muted-foreground transition-colors group-hover:border-border group-hover:bg-muted">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium leading-tight text-foreground">
            {label}
          </span>
          <span className="mt-0.5 block truncate text-xs leading-none text-muted-foreground">
            <span className="truncate">Built-in</span>
          </span>
        </span>
        {badge}
      </button>
      {isOpen && (
        <div className="mb-2 ml-[3.75rem] overflow-hidden rounded-md border border-border/70 bg-background/70">
          {children}
        </div>
      )}
    </div>
  );
}

function ToolFilterMenu<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  const selected = options.find((option) => option.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 cursor-pointer gap-1.5 rounded-md bg-transparent px-2.5 text-sm font-medium"
        >
          <IconAdjustmentsHorizontal className="size-4 text-muted-foreground" />
          <span>{selected?.label ?? label}</span>
          <IconChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-36">
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Asset Library panel ──────────────────────────────────────────────────────

interface AssetLibraryPanelProps {
  context: DesignExtensionSlotContext;
}

type FigmaLibraryAsset = {
  id: string;
  kind: "component" | "component_set";
  fileKey: string;
  nodeId: string | null;
  componentKey: string | null;
  name: string;
  description: string | null;
  thumbnailUrl: string | null;
  renderUrl: string | null;
  insertUrl: string | null;
  sourceUrl: string | null;
  containingFrame: { name: string | null; nodeId: string | null } | null;
  updatedAt: string | null;
};

type FigmaLibraryResponse = {
  fileKey: string;
  total: number;
  returned: number;
  assets: FigmaLibraryAsset[];
};

type DesignNativeAssetKind =
  | "section-frame"
  | "text-block"
  | "button"
  | "card"
  | "input"
  | "nav-bar"
  | "hero"
  | "feature-grid";

type DesignNativeAsset = {
  kind: DesignNativeAssetKind;
  title: string;
  description: string;
  category: "primitive" | "component" | "layout";
  componentName: string;
};

type DesignNativeAssetsResponse = {
  source: "design-native";
  assets: DesignNativeAsset[];
};

const NATIVE_ASSET_CATEGORY_LABELS: Record<
  DesignNativeAsset["category"],
  string
> = {
  primitive: "Primitive",
  component: "Component",
  layout: "Layout",
};

export function AssetLibraryPanel({ context }: AssetLibraryPanelProps) {
  const [assetPickerReady, setAssetPickerReady] = useState(false);
  const [figmaFileInput, setFigmaFileInput] = useState("");
  const [figmaQueryInput, setFigmaQueryInput] = useState("");
  const [figmaRequest, setFigmaRequest] = useState<{
    fileUrl: string;
    query?: string;
  } | null>(null);
  const nativeAssets = useActionQuery<DesignNativeAssetsResponse>(
    "list-design-native-assets",
  );
  const insertNativeAsset = useActionMutation("insert-design-native-asset");
  const insertAsset = useActionMutation("insert-asset");
  const insertFigmaAsset = useActionMutation("insert-figma-library-asset");
  const figmaAssets = useActionQuery<FigmaLibraryResponse>(
    "list-figma-library-assets",
    figmaRequest
      ? {
          fileUrl: figmaRequest.fileUrl,
          query: figmaRequest.query,
          limit: 48,
          renderFormat: "svg",
        }
      : undefined,
    { enabled: Boolean(figmaRequest) },
  );

  const handleReady = useCallback(
    (_payload: unknown, _event: MessageEvent, ref: EmbeddedAppRef) => {
      setAssetPickerReady(true);
      ref.postMessage("configure", {
        mediaType: "image",
        layout: "vertical",
        callerAppId: "design",
      });
    },
    [],
  );

  const handleMessage = useCallback(
    (name: string, payload: unknown) => {
      if (name === "close") {
        setAssetPickerReady(false);
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
    },
    [context.designId, context.activeFileId, insertAsset],
  );

  const handleInsertNativeAsset = (asset: DesignNativeAsset) => {
    insertNativeAsset.mutate(
      {
        kind: asset.kind,
        designId: context.designId || undefined,
        fileId: context.activeFileId || undefined,
      },
      {
        onSuccess: () => {
          toast.success(`${asset.title} inserted into design.`);
        },
        onError: (error) => {
          toast.error(error.message || "Failed to insert native asset.");
        },
      },
    );
  };

  const handleBrowseFigma = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fileUrl = figmaFileInput.trim();
    if (!fileUrl) return;
    const query = figmaQueryInput.trim();
    setFigmaRequest({ fileUrl, query: query || undefined });
  };

  const handleInsertFigmaAsset = (asset: FigmaLibraryAsset) => {
    const renderUrl = asset.insertUrl ?? asset.renderUrl ?? asset.thumbnailUrl;
    if (!renderUrl) {
      toast.error("Figma did not return an insertable render URL.");
      return;
    }
    insertFigmaAsset.mutate(
      {
        renderUrl,
        fileKey: asset.fileKey,
        nodeId: asset.nodeId ?? undefined,
        componentKey: asset.componentKey ?? undefined,
        kind: asset.kind,
        name: asset.name,
        description: asset.description ?? undefined,
        sourceUrl: asset.sourceUrl ?? undefined,
        designId: context.designId || undefined,
        fileId: context.activeFileId || undefined,
      },
      {
        onSuccess: () => {
          toast.success("Figma asset inserted into design.");
        },
        onError: (error) => {
          toast.error(error.message || "Failed to insert Figma asset.");
        },
      },
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Tabs defaultValue="native" className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-border/60 px-2 py-1.5">
          <TabsList className="grid h-7 w-full grid-cols-3 rounded-md p-0.5">
            <TabsTrigger value="native" className="h-6 gap-1 px-2 !text-[11px]">
              <IconAssembly className="size-3" />
              Native
            </TabsTrigger>
            <TabsTrigger value="media" className="h-6 gap-1 px-2 !text-[11px]">
              <IconPhoto className="size-3" />
              Media
            </TabsTrigger>
            <TabsTrigger value="figma" className="h-6 gap-1 px-2 !text-[11px]">
              <IconBrandFigma className="size-3" />
              Figma
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="native"
          className="design-inspector-scroll m-0 min-h-0 flex-1 overflow-y-auto p-2.5"
        >
          {nativeAssets.isLoading && (
            <div className="space-y-1.5">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-16 rounded-md" />
              ))}
            </div>
          )}

          {nativeAssets.isError && (
            <p className="rounded border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[10px] leading-snug text-destructive">
              {nativeAssets.error.message}
            </p>
          )}

          {!nativeAssets.isLoading && nativeAssets.data && (
            <div className="space-y-1.5">
              {nativeAssets.data.assets.map((asset) => (
                <button
                  key={asset.kind}
                  type="button"
                  disabled={
                    !context.activeFileId || insertNativeAsset.isPending
                  }
                  onClick={() => handleInsertNativeAsset(asset)}
                  className="group flex w-full cursor-pointer items-start gap-2 rounded-md border border-border bg-background px-2 py-2 text-left transition hover:border-primary/50 hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-55"
                >
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/50 text-muted-foreground group-hover:text-foreground">
                    <IconAssembly className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate !text-[11px] font-medium leading-tight text-foreground">
                        {asset.title}
                      </span>
                      <span className="shrink-0 rounded border border-border/70 px-1 py-0.5 text-[9px] leading-none text-muted-foreground">
                        {NATIVE_ASSET_CATEGORY_LABELS[asset.category]}
                      </span>
                    </span>
                    <span className="mt-1 line-clamp-2 text-[10px] leading-snug text-muted-foreground">
                      {asset.description}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent
          value="media"
          className="m-0 flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <div className="relative min-h-[540px] flex-1 overflow-hidden bg-background">
            {!assetPickerReady && (
              <div className="absolute inset-0 z-10 p-2.5">
                <Skeleton className="h-full w-full rounded-none" />
              </div>
            )}
            <EmbeddedApp
              url={assetsPickerUrl()}
              title="Assets picker"
              onLoad={() => setAssetPickerReady(true)}
              onReady={handleReady}
              onMessage={handleMessage}
              className="h-full w-full"
            />
          </div>
        </TabsContent>

        <TabsContent
          value="figma"
          className="design-inspector-scroll m-0 min-h-0 flex-1 overflow-y-auto p-2.5"
        >
          <form className="space-y-1.5" onSubmit={handleBrowseFigma}>
            <Input
              value={figmaFileInput}
              onChange={(event) => setFigmaFileInput(event.target.value)}
              placeholder="Figma file URL or key"
              className="h-7 !text-[11px] md:!text-[11px]"
            />
            <div className="flex gap-1.5">
              <Input
                value={figmaQueryInput}
                onChange={(event) => setFigmaQueryInput(event.target.value)}
                placeholder="Search components"
                className="h-7 min-w-0 flex-1 !text-[11px] md:!text-[11px]"
              />
              <Button
                type="submit"
                size="sm"
                className="h-7 cursor-pointer gap-1 px-2 !text-[11px]"
                disabled={!figmaFileInput.trim() || figmaAssets.isFetching}
              >
                <IconSearch className="size-3" />
                {figmaAssets.isFetching ? "Loading" : "Browse"}
              </Button>
            </div>
          </form>

          {figmaAssets.isError && (
            <p className="mt-2 rounded border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[10px] leading-snug text-destructive">
              {figmaAssets.error.message}
            </p>
          )}

          {figmaAssets.isFetching && (
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="aspect-square rounded-md" />
              ))}
            </div>
          )}

          {!figmaAssets.isFetching &&
            figmaAssets.data &&
            figmaAssets.data.assets.length === 0 && (
              <p className="mt-2 rounded border border-border bg-muted/30 px-2 py-1.5 text-[10px] leading-snug text-muted-foreground">
                No components matched this Figma file and search.
              </p>
            )}

          {!figmaAssets.isFetching &&
            figmaAssets.data &&
            figmaAssets.data.assets.length > 0 && (
              <div className="mt-2 space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                  <span>
                    {figmaAssets.data.returned} of {figmaAssets.data.total}
                  </span>
                  <span className="truncate">{figmaAssets.data.fileKey}</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {figmaAssets.data.assets.map((asset) => {
                    const preview = asset.thumbnailUrl ?? asset.renderUrl;
                    const canInsert = Boolean(
                      context.activeFileId &&
                      (asset.insertUrl ??
                        asset.renderUrl ??
                        asset.thumbnailUrl),
                    );
                    return (
                      <div
                        key={asset.id}
                        className="overflow-hidden rounded-md border border-border bg-background"
                      >
                        <button
                          type="button"
                          className="block aspect-square w-full cursor-pointer bg-muted/30"
                          disabled={!canInsert || insertFigmaAsset.isPending}
                          onClick={() => handleInsertFigmaAsset(asset)}
                        >
                          {preview ? (
                            <img
                              src={preview}
                              alt={asset.name}
                              className="size-full object-contain p-2"
                              loading="lazy"
                            />
                          ) : (
                            <span className="flex size-full items-center justify-center text-muted-foreground">
                              <IconAssembly className="size-5" />
                            </span>
                          )}
                        </button>
                        <div className="border-t border-border/70 px-1.5 py-1">
                          <div className="flex items-center gap-1">
                            <span className="min-w-0 flex-1 truncate text-[10px] font-medium leading-tight">
                              {asset.name}
                            </span>
                            {asset.sourceUrl && (
                              <a
                                href={asset.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="shrink-0 text-muted-foreground hover:text-foreground"
                                aria-label="Open in Figma"
                              >
                                <IconExternalLink className="size-3" />
                              </a>
                            )}
                          </div>
                          <p className="mt-0.5 truncate text-[9px] text-muted-foreground">
                            {asset.kind === "component_set"
                              ? "Component set"
                              : "Component"}
                            {asset.containingFrame?.name
                              ? ` · ${asset.containingFrame.name}`
                              : ""}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
        </TabsContent>
      </Tabs>

      {!context.activeFileId && (
        <p className="border-t border-border/60 px-2.5 py-1.5 text-[10px] text-amber-600 dark:text-amber-400">
          Open a design screen first to insert assets.
        </p>
      )}
    </div>
  );
}

// ─── Shader Fills panel ───────────────────────────────────────────────────────

interface ShaderFillsExtPanelProps {
  context: DesignExtensionSlotContext;
}

interface PreviewedShaderFill {
  descriptor: ShaderDescriptor;
  fileId?: string;
  nodeId?: string;
  selector?: string;
}

function ShaderFillsExtPanel({ context }: ShaderFillsExtPanelProps) {
  const [showShaders, setShowShaders] = useState(false);
  const clearPreviewRef = useRef(context.onShaderFillPreviewClear);
  useEffect(() => {
    clearPreviewRef.current = context.onShaderFillPreviewClear;
  }, [context.onShaderFillPreviewClear]);
  useEffect(
    () => () => {
      clearPreviewRef.current?.();
    },
    [],
  );
  const closeShaders = () => {
    context.onShaderFillPreviewClear?.();
    setShowShaders(false);
  };
  // The most recently previewed descriptor — Apply persists exactly this one,
  // so the write is intentional (one atomic call) rather than firing on every
  // slider tweak.
  const [previewed, setPreviewed] = useState<PreviewedShaderFill | null>(null);
  const applyShaderFill = useActionMutation("apply-shader-fill");

  // The persisting apply path needs an HTML file plus a target element. Without
  // a selected element we can still preview, but we cannot write a fill.
  const targetNodeId = context.selectedElement?.sourceId ?? undefined;
  const targetSelector = context.selectedElement?.selector ?? undefined;
  const canPersist = Boolean(
    context.activeFileId && (targetNodeId || targetSelector),
  );
  const previewMatchesTarget = Boolean(
    previewed &&
    previewed.fileId === context.activeFileId &&
    previewed.nodeId === targetNodeId &&
    previewed.selector === targetSelector,
  );

  useEffect(() => {
    setPreviewed(null);
  }, [context.activeFileId, targetNodeId, targetSelector]);

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
          revision: context.activeFileUpdatedAt || undefined,
          currentContent: context.activeContent,
        },
      },
      {
        onSuccess: (res) => {
          const r = res as
            | {
                fileId?: unknown;
                patchedContent?: unknown;
                persisted?: boolean;
                conflict?: boolean;
                error?: unknown;
                note?: unknown;
                updatedAt?: unknown;
              }
            | undefined;
          if (r?.persisted) {
            if (
              typeof r.fileId === "string" &&
              typeof r.patchedContent === "string"
            ) {
              context.onShaderFillApplied?.(
                r.fileId,
                r.patchedContent,
                typeof r.updatedAt === "string" ? r.updatedAt : undefined,
              );
            }
            toast.success("Shader fill applied to the selected element.");
          } else if (r?.conflict) {
            toast.error(
              typeof r.error === "string" || typeof r.note === "string"
                ? String(r.error ?? r.note)
                : "This file changed since the shader fill was previewed. Refresh and try again.",
            );
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
            className="h-6 cursor-pointer gap-1 px-2 !text-[11px]"
            onClick={() => setShowShaders(true)}
          >
            <IconPalette className="size-3" />
            Browse Shaders
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <ShaderFillsPanel
        onApply={(descriptor, css) => {
          // Preview only: ShaderFillsPanel fires apply-shader (planning/codegen)
          // for agent context on every tune and the iframe shows the gradient.
          // We just record the latest descriptor here; the explicit Apply
          // button below performs the single intentional persist write.
          setPreviewed({
            descriptor,
            fileId: context.activeFileId || undefined,
            nodeId: targetNodeId,
            selector: targetSelector,
          });
          context.onShaderFillPreview?.(descriptor, css);
        }}
        onBack={closeShaders}
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
            className="h-6 cursor-pointer gap-1 px-2 !text-[11px]"
            disabled={!previewMatchesTarget || applyShaderFill.isPending}
            onClick={() => {
              if (previewMatchesTarget && previewed) {
                persistFill(previewed.descriptor);
              }
            }}
          >
            <IconPalette className="size-3" />
            {applyShaderFill.isPending
              ? "Applying…"
              : previewMatchesTarget
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
    sendToDesignAgentChat({
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
          className="h-6 cursor-pointer gap-1 px-2 !text-[11px]"
          onClick={handleAskAgent}
        >
          <IconMessageCircle className="size-3" />
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
    sendToDesignAgentChat({
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
          className="h-6 cursor-pointer gap-1 px-2 !text-[11px]"
          onClick={handleAskAgent}
        >
          <IconMessageCircle className="size-3" />
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
  hideAssetLibrary = false,
  title,
}: DesignExtensionsPanelProps) {
  const t = useT();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<ToolSourceFilter>("all");
  const [categoryFilter, setCategoryFilter] =
    useState<ToolCategoryFilter>("all");
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

  const submitCreatePrompt: CreateExtensionSubmitHandler = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    sendToDesignAgentChat({
      message: `Create a Design extension: ${trimmed}`,
      context: buildExtensionCreateContext(trimmed, context),
      submit: true,
      openSidebar: true,
      newTab: true,
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
  const allFirstPartyRows: FirstPartyRow[] = [
    {
      id: "design.asset-library",
      label: "Asset Library",
      description: "Browse & insert assets into the active screen",
      category: "plugins",
      icon: <IconPhoto className="size-3.5" />,
      panel: <AssetLibraryPanel context={context} />,
    },
    {
      id: "design.shader-fills",
      label: "Shader Fills",
      description: "GPU shader fill presets — preview & apply",
      category: "shader",
      icon: <IconPalette className="size-3.5" />,
      panel: <ShaderFillsExtPanel context={context} />,
    },
    {
      id: "design.token-auditor",
      label: "Token Auditor",
      description: "Audit CSS token usage, flag clashes",
      category: "tokens",
      icon: <IconAssembly className="size-3.5" />,
      panel: <TokenAuditorPanel context={context} />,
    },
    {
      id: "design.motion-presets",
      label: "Motion Presets",
      description: "One-click animation presets for elements",
      category: "motion",
      icon: <IconPlayerPlay className="size-3.5" />,
      panel: <MotionPresetsPanel context={context} />,
    },
  ];
  const firstPartyRows = allFirstPartyRows.filter(
    (row) => !hideAssetLibrary || row.id !== "design.asset-library",
  );
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const sourceMatches = (source: ToolSourceFilter) =>
    sourceFilter === "all" || sourceFilter === source;
  const categoryMatches = (category: ToolCategoryFilter) =>
    categoryFilter === "all" || categoryFilter === category;
  const textMatches = (name: string, description?: string | null) => {
    if (!normalizedSearch) return true;
    return `${name} ${description ?? ""}`
      .toLowerCase()
      .includes(normalizedSearch);
  };
  const visibleFirstPartyRows = firstPartyRows.filter(
    (row) =>
      sourceMatches("built-in") &&
      categoryMatches(row.category) &&
      textMatches(row.label, row.description),
  );
  const visibleInstalls = installs.filter(
    (install) =>
      sourceMatches("extensions") &&
      categoryMatches("plugins") &&
      textMatches(install.name, install.description),
  );
  const visibleInstallable = installable.filter(
    (extension) =>
      sourceMatches("extensions") &&
      categoryMatches("plugins") &&
      textMatches(extension.name, extension.description),
  );
  const hasAnyVisibleTool =
    visibleFirstPartyRows.length > 0 ||
    visibleInstalls.length > 0 ||
    visibleInstallable.length > 0;

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-border/60 px-4">
        <h3 className="min-w-0 flex-1 truncate text-xl font-semibold tracking-tight text-foreground">
          {title ?? t("designEditor.extensions")}
        </h3>
        <CreateExtensionPopover
          open={createOpen}
          onOpenChange={setCreateOpen}
          onSubmit={submitCreatePrompt}
        />
      </div>

      <div className="design-inspector-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-4">
        <div className="relative mb-4">
          <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search all tools"
            className="h-9 border-0 bg-muted/70 pl-8 text-sm shadow-none focus-visible:ring-1"
          />
        </div>

        <div className="mb-5 flex flex-wrap gap-2">
          <ToolFilterMenu
            label="Source"
            value={sourceFilter}
            onChange={setSourceFilter}
            options={[
              { value: "all", label: "Source" },
              { value: "built-in", label: "Built-in" },
              { value: "extensions", label: "Extensions" },
            ]}
          />
          <ToolFilterMenu
            label="Category"
            value={categoryFilter}
            onChange={setCategoryFilter}
            options={[
              { value: "all", label: "Category" },
              { value: "shader", label: "Shaders" },
              { value: "tokens", label: "Tokens" },
              { value: "motion", label: "Motion" },
              { value: "plugins", label: "Plugins" },
            ]}
          />
        </div>

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-12 rounded-md" />
            <Skeleton className="h-12 rounded-md" />
            <Skeleton className="h-12 rounded-md" />
          </div>
        ) : (
          <>
            {visibleInstalls.length > 0 ? (
              <div className="mb-6">
                <p className="mb-3 text-sm font-medium text-muted-foreground">
                  Recents
                </p>
                <div className="space-y-2">
                  {visibleInstalls.map((install) => (
                    <EmbeddedExtension
                      key={install.installId}
                      extensionId={install.extensionId}
                      slotId={slotId}
                      context={context}
                      initialHeight={180}
                      className="overflow-hidden rounded-md border border-border bg-background"
                    />
                  ))}
                </div>
              </div>
            ) : null}

            {visibleFirstPartyRows.length > 0 ? (
              <div className="mb-6">
                <p className="mb-3 text-sm font-medium text-muted-foreground">
                  Suggested
                </p>
                <div className="space-y-1">
                  {visibleFirstPartyRows.map((row) => (
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
              </div>
            ) : null}

            {visibleInstallable.length > 0 ? (
              <div className="border-t border-border/60 pt-4">
                <p className="mb-3 text-sm font-medium text-muted-foreground">
                  Available
                </p>
                <div className="space-y-1">
                  {visibleInstallable.map((extension) => (
                    <button
                      key={extension.extensionId}
                      type="button"
                      disabled={installingId === extension.extensionId}
                      onClick={() => installExtension(extension.extensionId)}
                      className="group flex w-full cursor-pointer items-center gap-3 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-accent/60 active:bg-accent disabled:cursor-default disabled:opacity-50"
                    >
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/70 text-muted-foreground transition-colors group-hover:border-border group-hover:bg-muted">
                        <IconPuzzle className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium leading-tight text-foreground">
                          {extension.name}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5 truncate text-xs leading-none text-muted-foreground">
                          <IconPuzzle className="size-3 shrink-0" />
                          <span className="truncate">
                            {extension.description || "Extension"}
                          </span>
                        </span>
                      </span>
                      <span className="shrink-0 text-xs font-medium text-muted-foreground">
                        {t("designEditor.extensionsInstall")}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {!hasAnyVisibleTool ? (
              <div className="py-12 text-center">
                <div className="mx-auto mb-3 flex size-9 items-center justify-center rounded-md bg-muted/70">
                  <IconSearch className="size-4 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium text-foreground">
                  No tools found
                </p>
                <p className="mx-auto mt-1 max-w-52 text-xs leading-5 text-muted-foreground">
                  Try another search or clear the filters.
                </p>
              </div>
            ) : null}
          </>
        )}
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
  onSubmit: CreateExtensionSubmitHandler;
}) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const canSubmit = draft.trim().length > 0;
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit(draft);
    setDraft("");
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 cursor-pointer rounded-md bg-transparent px-3 text-sm font-medium"
          aria-label={t("designEditor.addExtension")}
        >
          Create
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-80 p-3">
        <form onSubmit={handleSubmit} className="space-y-3">
          <p className="px-0.5 text-sm font-semibold text-foreground">
            {t("designEditor.extensionsPromptTitle")}
          </p>
          <Textarea
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t("designEditor.extensionsPlaceholder")}
            className="min-h-24 resize-none border-border/80 bg-background/80 text-sm shadow-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0"
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-3"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              className="h-8 px-3"
              disabled={!canSubmit}
            >
              Create
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
