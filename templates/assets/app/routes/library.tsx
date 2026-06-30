import {
  AgentToggleButton,
  appPath,
  getBrowserTabId,
  getEmbedAuthToken,
  isEmbedMcpChatBridgeActive,
  isEmbedAuthActive,
  insertAgentComposerReference,
  readClientAppState,
  sendMcpAppHostMessage,
  updateMcpAppModelContext,
  useActionMutation,
  useActionQuery,
  useAgentChatGenerating,
  useT,
  writeClientAppState,
} from "@agent-native/core/client";
import {
  createEmbeddedAppBridge,
  type EmbeddedAppBridge,
} from "@agent-native/core/embedding";
import {
  EMBED_MODE_QUERY_PARAM,
  EMBED_TOKEN_QUERY_PARAM,
} from "@agent-native/core/shared";
import {
  IconArrowUpRight,
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconClipboard,
  IconLibraryPhoto,
  IconPhotoPlus,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  useSearchParams,
  useLocation,
  useNavigate,
  useParams,
} from "react-router";
import { toast } from "sonner";

import { CreateLibraryDialog } from "@/components/library/CreateLibraryDialog";
import { LibraryPresetGrid } from "@/components/library/LibraryPresetGrid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  sortLibrariesByUsage,
  type ImageLibrarySummary,
} from "@/lib/libraries";
import { buildPickerChatHandoffPrompt } from "@/lib/picker-chat-handoff";
import { cn } from "@/lib/utils";

import type {
  AssetVariantState,
  ImageQualityTier,
  StyleStrength,
} from "../../shared/api";
import {
  DEFAULT_LIBRARY_PRESETS,
  LibraryPreset,
} from "../../shared/library-presets";
import {
  BrandKitDetailRoute,
  LiveCandidatesStage,
  type VariantSlot,
} from "./brand-kits.$id";

type AssetTab = "all" | "generated" | "drafts" | "references";

function isGeneratedAsset(asset: Asset) {
  const role = asset.role ?? "";
  return role === "generated" || role === "active" || role === "candidate";
}

function isDraftAsset(asset: Asset) {
  return asset.role === "generated" && asset.status === "candidate";
}

function assetMatchesTab(asset: Asset, tab: AssetTab) {
  if (tab === "all") return true;
  if (tab === "drafts") return isDraftAsset(asset);
  if (tab === "generated")
    return isGeneratedAsset(asset) && !isDraftAsset(asset);
  return !isGeneratedAsset(asset);
}

const ASPECT_RATIOS = ["16:9", "1:1", "9:16", "4:3", "3:4", "21:9"] as const;
const GENERATION_COUNTS = [1, 2, 3, 4, 6] as const;
const STARTER_PRESET = DEFAULT_LIBRARY_PRESETS[0];
const STARTER_LIBRARY_ID = `starter:${STARTER_PRESET.id}`;
const MCP_APP_CHAT_BRIDGE_QUERY_PARAM = "__an_mcp_chat_bridge";
const PICKER_INLINE_SELECT_CLASS =
  "h-7 w-auto min-w-0 max-w-full rounded-md border-0 bg-transparent px-1.5 py-1 text-xs font-medium text-muted-foreground shadow-none ring-offset-transparent transition hover:bg-accent/50 hover:text-foreground focus:ring-0 focus:ring-offset-0 sm:px-2 [&>svg]:ms-1 [&>svg]:size-3.5 [&>svg]:opacity-60";
type PickerMediaType = "image" | "video";
type PickerLayout = "default" | "vertical";

type Asset = {
  id: string;
  libraryId: string;
  role?: string | null;
  status?: string | null;
  title?: string | null;
  description?: string | null;
  altText?: string | null;
  prompt?: string | null;
  mediaType?: string | null;
  mimeType?: string | null;
  width?: number | null;
  height?: number | null;
  url?: string;
  previewUrl?: string;
  thumbnailUrl?: string;
  downloadUrl?: string;
  embedUrl?: string;
  embedPath?: string;
  libraryTitle?: string | null;
  lineage?: {
    label?: string | null;
    kind?: string | null;
    sourceLabel?: string | null;
  } | null;
};

type Library = {
  id: string;
  title: string;
  description?: string | null;
};

type GenerationConfig = {
  builderEnabled?: boolean;
  builderConnected?: boolean;
  geminiConfigured?: boolean;
  configured?: boolean;
  lastIssue?: { message?: unknown } | null;
};

type GenerationPreset = {
  id: string;
  title: string;
  mediaType?: string | null;
  aspectRatio?: string | null;
  imageSize?: string | null;
  model?: string | null;
};

type HostConfig = {
  mediaType?: PickerMediaType;
  prompt?: string;
  query?: string;
  libraryId?: string;
  libraryHint?: string;
  aspectRatio?: string;
  presetId?: string;
  count?: number;
  tier?: ImageQualityTier;
  styleStrength?: StyleStrength;
  includeLogo?: boolean;
  callerAppId?: string;
  layout?: PickerLayout;
  autoGenerate?: boolean;
  candidateRunIds?: string[];
};

// Preselect the library whose title/description best matches a free-text brand
// or use-case hint. Falls back to no match (caller uses the first library).
function matchLibraryByHint(
  libraries: Library[],
  hint: string | undefined,
): string | undefined {
  const needle = hint?.trim().toLowerCase();
  if (!needle) return undefined;
  const terms = needle.split(/\s+/).filter(Boolean);
  let best: { id: string; score: number } | null = null;
  for (const library of libraries) {
    const haystack =
      `${library.title ?? ""} ${library.description ?? ""}`.toLowerCase();
    if (!haystack.trim()) continue;
    let score = 0;
    if (haystack.includes(needle)) score += 10;
    for (const term of terms) {
      if (haystack.includes(term)) score += 1;
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { id: library.id, score };
    }
  }
  return best?.id;
}

function isEmbeddedWindow() {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function normalizeCount(value: unknown): number {
  if (value === null || value === undefined || value === "") return 3;
  const count = Number(value);
  if (!Number.isFinite(count)) return 3;
  const rounded = Math.round(count);
  return Math.min(6, Math.max(1, rounded));
}

function normalizeMediaType(value: unknown): PickerMediaType {
  return value === "video" ? "video" : "image";
}

function normalizePickerLayout(value: unknown): PickerLayout | undefined {
  return value === "vertical" ? "vertical" : undefined;
}

function normalizeBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["", "0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function normalizeTier(value: unknown): ImageQualityTier | undefined {
  return value === "auto" || value === "fast" || value === "best"
    ? value
    : undefined;
}

function normalizeStyleStrength(value: unknown): StyleStrength | undefined {
  return value === "subtle" || value === "balanced" || value === "strong"
    ? value
    : undefined;
}

function normalizeCandidateRunIds(value: unknown): string[] | undefined {
  if (value === null || value === undefined) return undefined;
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const ids = raw
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
  return ids;
}

function searchParamsEnableEmbeddedLibrary(params: URLSearchParams): boolean {
  const embedMode = params.get(EMBED_MODE_QUERY_PARAM);
  return (
    params.has(EMBED_TOKEN_QUERY_PARAM) ||
    embedMode === "1" ||
    embedMode === "true"
  );
}

function searchParamsRequestPicker(params: URLSearchParams): boolean {
  const mcpChatBridge = params.get(MCP_APP_CHAT_BRIDGE_QUERY_PARAM);
  return (
    params.get("__an_picker") === "1" ||
    mcpChatBridge === "1" ||
    mcpChatBridge === "true"
  );
}

function normalizeHostConfig(value: unknown): HostConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const config: HostConfig = {
    mediaType:
      record.mediaType === "image" || record.mediaType === "video"
        ? record.mediaType
        : undefined,
    prompt: typeof record.prompt === "string" ? record.prompt : undefined,
    query: typeof record.query === "string" ? record.query : undefined,
    libraryId:
      typeof record.libraryId === "string" ? record.libraryId : undefined,
    libraryHint:
      typeof record.libraryHint === "string" ? record.libraryHint : undefined,
    aspectRatio:
      typeof record.aspectRatio === "string" ? record.aspectRatio : undefined,
    presetId: typeof record.presetId === "string" ? record.presetId : undefined,
    count:
      record.count === undefined ? undefined : normalizeCount(record.count),
    tier: normalizeTier(record.tier),
    styleStrength: normalizeStyleStrength(record.styleStrength),
    includeLogo: normalizeBoolean(record.includeLogo),
    callerAppId:
      typeof record.callerAppId === "string" ? record.callerAppId : undefined,
    layout: normalizePickerLayout(record.layout),
    candidateRunIds: normalizeCandidateRunIds(record.candidateRunIds),
  };
  if (Object.prototype.hasOwnProperty.call(record, "autoGenerate")) {
    config.autoGenerate = normalizeBoolean(record.autoGenerate) ?? false;
  }
  return config;
}

function embeddedAppOrigin() {
  if (typeof window === "undefined") return undefined;
  const externalOrigin =
    typeof (window as any).__AGENT_NATIVE_EXTERNAL_EMBED?.origin === "string"
      ? (window as any).__AGENT_NATIVE_EXTERNAL_EMBED.origin
      : undefined;
  if (externalOrigin) return externalOrigin;
  if (typeof document === "undefined") return undefined;
  const baseHref =
    document.querySelector("base")?.getAttribute("href") ?? document.baseURI;
  try {
    const baseOrigin = new URL(baseHref).origin;
    return baseOrigin === window.location.origin ? undefined : baseOrigin;
  } catch {
    return undefined;
  }
}

function absoluteAppUrl(value: string) {
  if (typeof window === "undefined") return value;
  const path = value.startsWith("/") ? appPath(value) : value;
  try {
    return new URL(
      path,
      embeddedAppOrigin() ?? window.location.origin,
    ).toString();
  } catch {
    return value;
  }
}

function absoluteAssetUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const path =
      value.startsWith("/") && !value.startsWith("//") ? appPath(value) : value;
    return new URL(path, absoluteAppUrl("/")).toString();
  } catch {
    return value;
  }
}

function shouldUseContentProxyForPreview(asset: Asset) {
  if (typeof window === "undefined") return false;
  if (!isEmbeddedWindow()) return false;
  return (
    asset.libraryId !== STARTER_LIBRARY_ID && !asset.id.startsWith("starter-")
  );
}

function embedTokenParam() {
  if (typeof window === "undefined") return null;
  const externalToken =
    typeof (window as any).__AGENT_NATIVE_EXTERNAL_EMBED?.token === "string"
      ? (window as any).__AGENT_NATIVE_EXTERNAL_EMBED.token
      : null;
  if (externalToken) return externalToken;
  return (
    getEmbedAuthToken() ??
    new URLSearchParams(window.location.search).get("__an_embed_token")
  );
}

function assetContentUrl(asset: Asset, variant?: "thumb") {
  const params = new URLSearchParams();
  if (variant === "thumb") params.set("variant", "thumb");
  const embedToken = embedTokenParam();
  if (embedToken) params.set("__an_embed_token", embedToken);
  const query = params.toString();
  return absoluteAssetUrl(
    `/api/assets/${asset.id}/content${query ? `?${query}` : ""}`,
  );
}

function uniqueSources(sources: Array<string | undefined>) {
  return sources.filter(
    (source, index, all): source is string =>
      typeof source === "string" &&
      source.length > 0 &&
      all.indexOf(source) === index,
  );
}

function assetThumbnailSources(asset: Asset) {
  if (shouldUseContentProxyForPreview(asset)) {
    return uniqueSources([
      assetContentUrl(asset, asset.thumbnailUrl ? "thumb" : undefined),
      assetContentUrl(asset),
    ]);
  }
  return uniqueSources(
    [asset.thumbnailUrl, asset.previewUrl, asset.downloadUrl].map((source) =>
      absoluteAssetUrl(source),
    ),
  );
}

function assetOverlaySources(asset: Asset) {
  if (shouldUseContentProxyForPreview(asset)) {
    return uniqueSources([assetContentUrl(asset)]);
  }
  return uniqueSources(
    [asset.previewUrl, asset.downloadUrl, asset.url, asset.thumbnailUrl].map(
      (source) => absoluteAssetUrl(source),
    ),
  );
}

function previewFetchCredentials(
  source: string | undefined,
): RequestCredentials {
  if (!source || typeof window === "undefined") return "omit";
  try {
    return new URL(source, window.location.href).origin ===
      window.location.origin
      ? "same-origin"
      : "omit";
  } catch {
    return "omit";
  }
}

/**
 * True when `url` points at a different origin than the current document.
 * Inline embeds load under `Cross-Origin-Embedder-Policy: require-corp`, which
 * blocks cross-origin `<img>` subresources unless they opt in via CORS. Marking
 * cross-origin previews `crossOrigin="anonymous"` makes the browser CORS-fetch
 * them (the asset CDN sends `Access-Control-Allow-Origin: *`), satisfying COEP.
 * Same-origin and `data:`/`blob:` URLs return false so their cookies / inline
 * bytes are untouched.
 */
function isCrossOriginPreview(url: string | undefined): boolean {
  if (!url || typeof window === "undefined") return false;
  if (url.startsWith("data:") || url.startsWith("blob:")) return false;
  try {
    return new URL(url, window.location.href).origin !== window.location.origin;
  } catch {
    return false;
  }
}

function assetPayload(asset: Asset, requestedMediaType: PickerMediaType) {
  const mediaType =
    asset.mediaType === "video" || asset.mimeType?.startsWith("video/")
      ? "video"
      : requestedMediaType;
  const assetTitle = asset.title?.trim() ?? "";
  const assetAltText = asset.altText?.trim() ?? "";
  const assetPrompt = asset.prompt?.trim() ?? "";
  const displayTitle = assetDisplayTitle(asset);
  const fallbackLabel = assetTitle || assetPrompt || displayTitle || asset.id;
  const embeddedContentUrl = shouldUseContentProxyForPreview(asset)
    ? assetContentUrl(asset)
    : undefined;
  const previewUrl = absoluteAssetUrl(embeddedContentUrl ?? asset.previewUrl);
  const url = absoluteAssetUrl(
    embeddedContentUrl ?? asset.previewUrl ?? asset.downloadUrl ?? asset.url,
  );
  const thumbnailUrl = absoluteAssetUrl(asset.thumbnailUrl);
  const downloadUrl = absoluteAssetUrl(asset.downloadUrl);
  const embedUrl = absoluteAssetUrl(asset.embedUrl);
  return {
    id: asset.id,
    assetId: asset.id,
    libraryId: asset.libraryId,
    mediaType,
    url,
    previewUrl,
    thumbnailUrl,
    downloadUrl,
    embedUrl,
    embedPath: asset.embedPath,
    altText: assetAltText || fallbackLabel,
    title: assetTitle || fallbackLabel,
    prompt: asset.prompt ?? null,
    width: asset.width ?? null,
    height: asset.height ?? null,
    mimeType: asset.mimeType ?? null,
  };
}

function selectedAssetText(payload: ReturnType<typeof assetPayload>) {
  const url = payload.url ?? payload.downloadUrl ?? payload.previewUrl;
  return `Selected ${payload.mediaType} asset ${payload.assetId}${url ? `: ${url}` : ""}`;
}

function selectedAssetLabel(payload: ReturnType<typeof assetPayload>) {
  const title = payload.title?.trim() ?? "";
  const altText = payload.altText?.trim() ?? "";
  const prompt = payload.prompt?.trim() ?? "";
  const machineLikeTitle =
    title === payload.assetId || /^[A-Za-z0-9_-]{12,}$/.test(title);
  const genericGeneratedTitle = /^Original \d+$/i.test(title);
  if (prompt && (!title || machineLikeTitle || genericGeneratedTitle)) {
    return prompt;
  }
  if (altText && altText !== title) return altText;
  if (title && !machineLikeTitle) return title;
  return prompt || altText || title || payload.assetId;
}

function selectedAssetFollowUpMessage(
  payload: ReturnType<typeof assetPayload>,
) {
  const url = payload.url ?? payload.downloadUrl ?? payload.previewUrl;
  const label = selectedAssetLabel(payload);
  return [
    `Use this selected ${payload.mediaType} in the current work: ${label}`,
    url ? `URL: ${url}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Compact, agent-usable context — not the full internal payload. */
function selectedAssetContext(payload: ReturnType<typeof assetPayload>) {
  const url = payload.url ?? payload.downloadUrl ?? payload.previewUrl;
  const width = Number(payload.width);
  const height = Number(payload.height);
  return {
    assetId: payload.assetId,
    title: payload.title,
    mediaType: payload.mediaType,
    url,
    ...(Number.isFinite(width) && Number.isFinite(height) && width && height
      ? { width, height }
      : {}),
  };
}

function selectedAssetClipboardText(payload: ReturnType<typeof assetPayload>) {
  const url = payload.url ?? payload.downloadUrl ?? payload.previewUrl;
  const previewTip =
    payload.mediaType === "image" && url
      ? [
          `Markdown preview: ![Selected asset](${url})`,
          "If this remote preview does not render in Codex or Claude Code, download the image locally and embed the absolute local file path.",
        ]
      : [];
  return [
    selectedAssetFollowUpMessage(payload),
    ...previewTip,
    "",
    JSON.stringify(selectedAssetContext(payload), null, 2),
  ].join("\n");
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      resolve(value.includes(",") ? value.split(",")[1] : value);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Read failed"));
    reader.readAsDataURL(blob);
  });
}

const MCP_IMAGE_CONTENT_MAX_BYTES = 2.5 * 1024 * 1024;

function base64ByteLength(data: string) {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

async function fetchImageContent(url: string, fallbackMimeType: string) {
  const credentials =
    typeof window !== "undefined" &&
    new URL(url, window.location.href).origin === window.location.origin
      ? "same-origin"
      : "omit";
  const response = await fetch(url, { credentials });
  if (!response.ok) return null;
  const blob = await response.blob();
  const detectedMimeType = blob.type.startsWith("image/")
    ? blob.type
    : fallbackMimeType;
  return {
    type: "image",
    data: await blobToBase64(blob),
    mimeType: detectedMimeType,
  };
}

async function imageContentForAsset(payload: ReturnType<typeof assetPayload>) {
  const url = payload.url ?? payload.downloadUrl ?? payload.previewUrl;
  const mimeType = payload.mimeType?.startsWith("image/")
    ? payload.mimeType
    : "image/png";
  if (!url || payload.mediaType !== "image") return null;
  const sources = uniqueSources([url, payload.thumbnailUrl]);
  for (const source of sources) {
    try {
      const content = await fetchImageContent(source, mimeType);
      if (
        content &&
        base64ByteLength(content.data) <= MCP_IMAGE_CONTENT_MAX_BYTES
      ) {
        return content;
      }
    } catch {
      // Try the next smaller source.
    }
  }
  return null;
}

function notifyMcpHost(payload: ReturnType<typeof assetPayload>) {
  return Promise.resolve(imageContentForAsset(payload))
    .catch(() => null)
    .then((imageContent) => {
      const context = { selectedAsset: payload };
      const message = selectedAssetFollowUpMessage(payload);
      const modelContent = [
        { type: "text", text: selectedAssetText(payload) },
        ...(imageContent ? [imageContent] : []),
      ];
      const chatContent = [
        { type: "text", text: message },
        ...(imageContent ? [imageContent] : []),
      ];

      return Promise.resolve(
        updateMcpAppModelContext({
          structuredContent: context,
          content: modelContent,
        }) || false,
      )
        .catch(() => false)
        .then((contextOk) => {
          return Promise.resolve(
            sendMcpAppHostMessage({
              message,
              context: JSON.stringify(context, null, 2),
              content: chatContent,
              structuredContent: context,
            }) || false,
          )
            .catch(() => false)
            .then((chatOk) => contextOk || chatOk);
        });
    });
}

function assetDisplayTitle(asset: Asset) {
  return (
    asset.lineage?.label || asset.title || asset.prompt || "Untitled asset"
  );
}

function AssetThumbnail({ asset }: { asset: Asset }) {
  const sources = assetThumbnailSources(asset);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [unavailable, setUnavailable] = useState(false);
  const source = sources[sourceIndex];
  const proxiedPreview = shouldUseContentProxyForPreview(asset);
  const [displayUrl, setDisplayUrl] = useState<string | undefined>(
    proxiedPreview ? undefined : source,
  );
  const sourcesKey = sources.join("\n");

  useEffect(() => {
    setSourceIndex(0);
    setUnavailable(false);
  }, [sourcesKey]);

  function tryNextSource() {
    const nextIndex = sourceIndex + 1;
    if (nextIndex < sources.length) {
      setSourceIndex(nextIndex);
    } else {
      setDisplayUrl(undefined);
      setUnavailable(true);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const proxied = shouldUseContentProxyForPreview(asset);
    if (!source || unavailable) {
      setDisplayUrl(undefined);
      return;
    }
    if (!proxied) {
      setDisplayUrl(source);
      return;
    }
    setDisplayUrl(undefined);
    fetch(source, {
      cache: "no-store",
      credentials: previewFetchCredentials(source),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Preview fetch failed");
        const blob = await response.blob();
        const base64 = await blobToBase64(blob);
        return `data:${blob.type || asset.mimeType || "image/png"};base64,${base64}`;
      })
      .then((dataUrl) => {
        if (!cancelled) setDisplayUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) tryNextSource();
      });
    return () => {
      cancelled = true;
    };
  }, [asset.mimeType, source, sourceIndex, unavailable]);

  if (!displayUrl) {
    return <div className="h-full w-full bg-muted" />;
  }

  return (
    <img
      src={displayUrl}
      crossOrigin={isCrossOriginPreview(displayUrl) ? "anonymous" : undefined}
      alt={asset.altText ?? asset.title ?? ""}
      className="h-full w-full object-contain transition group-hover:scale-[1.02]"
      onError={tryNextSource}
    />
  );
}

function AssetOverlayImage({ asset }: { asset: Asset }) {
  const t = useT();
  const sources = assetOverlaySources(asset);
  const sourcesKey = sources.join("\n");
  const [sourceIndex, setSourceIndex] = useState(0);
  const source = sources[sourceIndex];

  useEffect(() => {
    setSourceIndex(0);
  }, [sourcesKey]);

  if (!source) {
    return (
      <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground">
        {t("brandKitDetail.previewUnavailable")}
      </div>
    );
  }

  return (
    <img
      src={source}
      crossOrigin={isCrossOriginPreview(source) ? "anonymous" : undefined}
      alt={asset.altText ?? asset.title ?? ""}
      className="max-h-[85vh] w-full rounded-lg object-contain"
      onError={() =>
        setSourceIndex((index) =>
          index + 1 < sources.length ? index + 1 : index,
        )
      }
    />
  );
}

function EmptyLibraryStarter({ onCreateBlank }: { onCreateBlank: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const { data: presetData } = useActionQuery("list-library-presets", {});
  const createFromPreset = useActionMutation("create-library-from-preset");
  const [creatingPresetId, setCreatingPresetId] = useState<string | null>(null);
  const presets = ((presetData as any)?.presets ?? []) as LibraryPreset[];

  function createPresetLibrary(presetId: string) {
    setCreatingPresetId(presetId);
    createFromPreset.mutate(
      { presetId } as any,
      {
        onSuccess: (library: any) => {
          setCreatingPresetId(null);
          navigate(`/library/${library.id}`);
        },
        onError: (error: Error) => {
          setCreatingPresetId(null);
          toast.error(error.message || t("brandKits.presetCreateFailed"));
        },
      } as any,
    );
  }

  return (
    <div className="mx-auto flex min-h-full max-w-5xl flex-col justify-center px-6 py-10">
      <div className="mx-auto max-w-2xl text-center">
        <IconLibraryPhoto className="mx-auto h-10 w-10 text-muted-foreground" />
        <h2 className="mt-4 text-xl font-semibold tracking-tight">
          {t("library.buildYourFirstKit")}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("library.buildYourFirstKitDescription")}
        </p>
      </div>
      <div className="mt-6">
        <LibraryPresetGrid
          presets={presets}
          creatingId={creatingPresetId}
          onCreate={createPresetLibrary}
        />
      </div>
      <div className="mt-5 flex justify-center">
        <Button variant="outline" onClick={onCreateBlank}>
          {t("library.createBlankKit")}
        </Button>
      </div>
    </div>
  );
}

function LibraryShellHeader({
  selectedLibraryId = null,
  libraries,
  isLoading,
  onCreateKit,
}: {
  selectedLibraryId?: string | null;
  libraries: ImageLibrarySummary[];
  isLoading?: boolean;
  onCreateKit: () => void;
}) {
  const t = useT();
  const selectedLibrary = selectedLibraryId
    ? libraries.find((library) => library.id === selectedLibraryId)
    : null;
  const title =
    selectedLibrary?.title ??
    (selectedLibraryId ? t("library.library") : t("library.allAssets"));
  const visibility = (selectedLibrary as any)?.visibility;

  return (
    <header className="border-b border-border bg-background px-4 py-3 md:px-6">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <LibraryKitSelector
            selectedLibraryId={selectedLibraryId}
            libraries={libraries}
            isLoading={isLoading}
            triggerLabel={title}
            triggerStyle="title"
            onCreateKit={onCreateKit}
          />
          {visibility ? (
            <Badge variant="outline" className="h-6 rounded-full px-2 text-xs">
              {visibility}
            </Badge>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 self-start sm:self-auto sm:flex-nowrap">
          {selectedLibraryId ? (
            <div
              id="assets-library-detail-primary-actions"
              className="contents"
              aria-label={t("library.primaryKitActions")}
            />
          ) : null}
          <Button
            size="sm"
            className="h-8 shrink-0 gap-1.5"
            onClick={onCreateKit}
          >
            <IconPhotoPlus className="h-4 w-4" />
            {t("library.newKit")}
          </Button>
          {selectedLibraryId ? (
            <div
              id="assets-library-detail-more-actions"
              className="contents"
              aria-label={t("library.kitActions")}
            />
          ) : null}
          <AgentToggleButton />
        </div>
      </div>
    </header>
  );
}

function LibraryKitSelector({
  selectedLibraryId = null,
  libraries,
  isLoading,
  triggerLabel,
  triggerStyle = "button",
  onCreateKit,
}: {
  selectedLibraryId?: string | null;
  libraries: ImageLibrarySummary[];
  isLoading?: boolean;
  triggerLabel?: string;
  triggerStyle?: "button" | "title";
  onCreateKit: () => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectedLibrary = selectedLibraryId
    ? libraries.find((library) => library.id === selectedLibraryId)
    : null;
  const filteredLibraries = useMemo(() => {
    const items = sortLibrariesByUsage(libraries.filter(Boolean));
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((library) =>
      [library.title, library.description]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [libraries, query]);

  function selectLibrary(libraryId: string | null) {
    setOpen(false);
    navigate(libraryId ? `/library/${libraryId}` : "/library");
  }
  const titleTrigger = triggerStyle === "title";

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        {titleTrigger ? (
          <button
            type="button"
            className="-ml-1.5 inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xl font-semibold leading-tight tracking-tight transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <span className="block min-w-0 max-w-[min(48rem,calc(100vw-7rem))] truncate sm:max-w-none">
              {triggerLabel ?? selectedLibrary?.title ?? t("library.allAssets")}
            </span>
            <IconChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-8 max-w-[18rem] gap-1.5 px-2.5"
          >
            <IconLibraryPhoto className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate">
              {triggerLabel ?? selectedLibrary?.title ?? t("library.allAssets")}
            </span>
            <IconChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(25rem,calc(100vw-2rem))] p-2"
      >
        <div className="flex h-9 items-center gap-2 rounded-md border border-border bg-background px-2.5">
          <IconSearch className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("library.searchKits")}
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="mt-2 max-h-72 overflow-y-auto">
          <button
            type="button"
            onClick={() => selectLibrary(null)}
            className={cn(
              "flex w-full min-w-0 items-center gap-3 rounded-md px-2 py-2 text-left transition hover:bg-accent",
              !selectedLibraryId && "bg-accent",
            )}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
              <IconLibraryPhoto className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {t("library.allAssets")}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {t("library.allAssetsDescription")}
              </span>
            </span>
            {!selectedLibraryId ? <IconCheck className="h-4 w-4" /> : null}
          </button>

          {isLoading ? (
            <div className="mt-2 grid gap-1.5">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-12 rounded-md" />
              ))}
            </div>
          ) : filteredLibraries.length ? (
            <div className="mt-1 grid gap-1">
              {filteredLibraries.map((library) => {
                const selected = selectedLibraryId === library.id;
                return (
                  <button
                    key={library.id}
                    type="button"
                    onClick={() => selectLibrary(library.id)}
                    className={cn(
                      "flex w-full min-w-0 items-center gap-3 rounded-md px-2 py-2 text-left transition hover:bg-accent",
                      selected && "bg-accent",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {library.title}
                      </span>
                      <span className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                        <Badge variant="secondary" className="px-1.5 py-0">
                          {t("library.referenceCount", {
                            count: library.referenceCount ?? 0,
                          })}
                        </Badge>
                        <Badge variant="outline" className="px-1.5 py-0">
                          {t("library.assetCount", {
                            count: library.generatedCount ?? 0,
                          })}
                        </Badge>
                      </span>
                    </span>
                    {selected ? <IconCheck className="h-4 w-4" /> : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="px-2 py-6 text-center text-sm text-muted-foreground">
              {t("library.noKitsMatch")}
            </div>
          )}
        </div>
        <div className="mt-2 border-t border-border pt-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-full justify-start gap-2"
            onClick={() => {
              setOpen(false);
              onCreateKit();
            }}
          >
            <IconPhotoPlus className="h-4 w-4" />
            {t("library.newKit")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function AllAssetsBrowser() {
  const t = useT();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [assetTab, setAssetTab] = useState<AssetTab>("all");
  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
  const [standaloneSelection, setStandaloneSelection] = useState<ReturnType<
    typeof assetPayload
  > | null>(null);
  const [standaloneCopyOk, setStandaloneCopyOk] = useState(false);

  const { data: assetData, isLoading } = useActionQuery("list-assets", {
    query: query.trim() || undefined,
  } as any) as {
    data?: { assets?: Asset[] };
    isLoading: boolean;
  };

  const allAssets = assetData?.assets ?? [];
  const assets = useMemo(
    () => allAssets.filter((asset) => assetMatchesTab(asset, assetTab)),
    [allAssets, assetTab],
  );
  const visibleAssetCount = assets.length;
  const assetCountLabel = isLoading
    ? t("library.loading")
    : query.trim() || assetTab !== "all"
      ? t("library.shownCount", { count: visibleAssetCount })
      : t("library.assetCount", { count: allAssets.length });
  const standaloneSelectionText = useMemo(
    () =>
      standaloneSelection
        ? selectedAssetClipboardText(standaloneSelection)
        : "",
    [standaloneSelection],
  );
  const standaloneSelectionUrl =
    standaloneSelection?.url ??
    standaloneSelection?.downloadUrl ??
    standaloneSelection?.previewUrl;

  const copyStandaloneSelection = useCallback(
    async (payload: ReturnType<typeof assetPayload>) => {
      const text = selectedAssetClipboardText(payload);
      try {
        await navigator.clipboard.writeText(text);
        setStandaloneCopyOk(true);
        toast.success(t("library.selectionCopied"));
      } catch {
        setStandaloneCopyOk(false);
        toast.info(t("library.selectionReady"));
      }
    },
    [],
  );

  function chooseAsset(asset: Asset) {
    const payload = assetPayload(asset, "image");
    setStandaloneSelection(payload);
    setStandaloneCopyOk(false);
    void copyStandaloneSelection(payload);
  }

  return (
    <div className="flex min-w-0 flex-col">
      <div className="border-b border-border px-4 py-3 md:px-6">
        <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <Tabs
              value={assetTab}
              onValueChange={(value) => setAssetTab(value as AssetTab)}
            >
              <TabsList className="h-9">
                <TabsTrigger value="all">{t("library.tabsAll")}</TabsTrigger>
                <TabsTrigger value="generated">
                  {t("library.generated")}
                </TabsTrigger>
                <TabsTrigger value="references">
                  {t("library.references")}
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <Badge
              variant="secondary"
              className="h-6 max-w-full rounded-full px-2 text-xs"
            >
              {assetCountLabel}
            </Badge>
          </div>
          <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-border/70 bg-background px-3 focus-within:ring-1 focus-within:ring-ring sm:max-w-sm">
            <IconSearch className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onInput={(event) => setQuery(event.currentTarget.value)}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("library.searchAssets")}
              className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>
      </div>

      {standaloneSelection && (
        <section className="shrink-0 overflow-hidden border-b border-border bg-muted/30 px-4 py-3 md:px-6">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                {selectedAssetLabel(standaloneSelection)}
              </div>
              {standaloneSelectionUrl && (
                <div className="truncate text-xs text-muted-foreground">
                  {standaloneSelectionUrl}
                </div>
              )}
            </div>
            <div className="flex w-full min-w-0 flex-wrap gap-2 sm:w-auto sm:flex-nowrap sm:justify-end">
              <Button
                variant="outline"
                size="sm"
                className="h-8 shrink-0 gap-1.5"
                onClick={() => copyStandaloneSelection(standaloneSelection)}
              >
                {standaloneCopyOk ? (
                  <IconCheck className="h-3.5 w-3.5" />
                ) : (
                  <IconClipboard className="h-3.5 w-3.5" />
                )}
                {standaloneCopyOk ? t("library.copied") : t("library.copy")}
              </Button>
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="h-8 shrink-0 gap-1.5"
              >
                <Link
                  to={`/asset/${encodeURIComponent(
                    standaloneSelection.assetId,
                  )}`}
                >
                  <IconArrowUpRight className="h-3.5 w-3.5" />
                  {t("library.open")}
                </Link>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                title={t("library.close")}
                aria-label={t("library.close")}
                className="h-8 w-8 shrink-0"
                onClick={() => {
                  setStandaloneSelection(null);
                  setStandaloneCopyOk(false);
                }}
              >
                <IconX className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <details className="mt-2">
            <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
              {t("library.showPasteText")}
            </summary>
            <Textarea
              readOnly
              value={standaloneSelectionText}
              className="mt-2 h-24 max-w-full resize-none border-border/70 bg-background font-mono text-[11px] leading-relaxed"
              onFocus={(event) => event.currentTarget.select()}
            />
          </details>
        </section>
      )}

      <main className="p-4 md:p-6">
        {isLoading ? (
          <div className="assets-library-grid grid grid-cols-2 gap-4">
            {Array.from({ length: 12 }).map((_, index) => (
              <Skeleton key={index} className="aspect-[4/3] rounded-lg" />
            ))}
          </div>
        ) : assets.length === 0 ? (
          <div className="flex min-h-64 items-center justify-center text-center">
            <div className="max-w-sm text-sm text-muted-foreground">
              {query
                ? t("library.noMatchingAssets")
                : t("library.noReusableAssets")}
            </div>
          </div>
        ) : (
          <div className="assets-library-grid grid grid-cols-2 gap-4">
            {assets.map((asset) => (
              <div
                key={asset.id}
                className="group relative overflow-hidden rounded-lg border border-border/80 bg-background transition hover:border-foreground/25 hover:bg-muted/10 focus-within:ring-2 focus-within:ring-ring"
              >
                <button
                  type="button"
                  aria-label={t("library.selectAsset", {
                    title: assetDisplayTitle(asset),
                  })}
                  onClick={() => setPreviewAsset(asset)}
                  title={assetDisplayTitle(asset)}
                  className="block w-full text-left focus-visible:outline-none"
                >
                  <div className="aspect-[4/3] bg-muted/40">
                    {asset.mediaType === "video" ||
                    asset.mimeType?.startsWith("video/") ? (
                      <video
                        src={asset.previewUrl ?? asset.downloadUrl ?? asset.url}
                        poster={asset.thumbnailUrl}
                        muted
                        playsInline
                        className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                      />
                    ) : (
                      <AssetThumbnail asset={asset} />
                    )}
                  </div>
                </button>
                {(asset as any).libraryTitle ? (
                  <button
                    type="button"
                    onClick={() => navigate(`/library/${asset.libraryId}`)}
                    className="absolute bottom-2 left-2 z-10 max-w-[calc(100%-1rem)] truncate rounded-full bg-background/95 px-2.5 py-1 text-[11px] font-medium shadow-sm transition hover:bg-background"
                  >
                    {(asset as any).libraryTitle}
                  </button>
                ) : null}
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label={t("library.copyToClipboard")}
                        onClick={(event) => {
                          event.stopPropagation();
                          chooseAsset(asset);
                        }}
                        className="absolute right-2 top-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full bg-background/90 text-foreground opacity-0 shadow-sm transition hover:bg-primary hover:text-primary-foreground focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
                      >
                        <IconClipboard className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t("library.copyToClipboard")}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            ))}
          </div>
        )}
      </main>

      <AssetPreviewDialog
        asset={previewAsset}
        assets={assets}
        onAssetChange={setPreviewAsset}
      />
    </div>
  );
}

function AssetPreviewDialog({
  asset,
  assets,
  onAssetChange,
}: {
  asset: Asset | null;
  assets: Asset[];
  onAssetChange: (asset: Asset | null) => void;
}) {
  const t = useT();
  return (
    <Dialog
      open={Boolean(asset)}
      onOpenChange={(open) => {
        if (!open) onAssetChange(null);
      }}
    >
      {asset &&
        (() => {
          const previewIndex = assets.findIndex(
            (candidate) => candidate.id === asset.id,
          );
          const hasPrev = previewIndex > 0;
          const hasNext = previewIndex >= 0 && previewIndex < assets.length - 1;
          const showPreviousAsset = () => {
            if (hasPrev) onAssetChange(assets[previewIndex - 1]);
          };
          const showNextAsset = () => {
            if (hasNext) onAssetChange(assets[previewIndex + 1]);
          };
          return (
            <DialogContent
              hideClose
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") showPreviousAsset();
                if (event.key === "ArrowRight") showNextAsset();
              }}
              className="max-w-4xl border-0 bg-transparent p-0 shadow-none"
            >
              <DialogTitle className="sr-only">
                {assetDisplayTitle(asset)}
              </DialogTitle>
              <DialogDescription className="sr-only">
                {t("library.fullSizePreview", {
                  title: assetDisplayTitle(asset),
                })}
              </DialogDescription>
              <div className="relative">
                <div className="absolute right-2 top-2 z-10 flex items-center gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/asset/${encodeURIComponent(asset.id)}`}>
                      {t("library.viewDetails")}
                    </Link>
                  </Button>
                  <DialogClose
                    aria-label={t("library.closePreview")}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    <IconX className="h-5 w-5" />
                  </DialogClose>
                </div>
                {asset.mediaType === "video" ||
                asset.mimeType?.startsWith("video/") ? (
                  <video
                    src={asset.previewUrl ?? asset.downloadUrl ?? asset.url}
                    poster={asset.thumbnailUrl}
                    controls
                    autoPlay
                    playsInline
                    className="max-h-[85vh] w-full rounded-lg bg-black object-contain"
                  />
                ) : (
                  <AssetOverlayImage asset={asset} />
                )}
              </div>
              {(hasPrev || hasNext) && (
                <div className="mt-5 flex justify-center gap-2">
                  <button
                    type="button"
                    aria-label={t("library.previousImage")}
                    onClick={showPreviousAsset}
                    disabled={!hasPrev}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <IconChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    aria-label={t("library.nextImage")}
                    onClick={showNextAsset}
                    disabled={!hasNext}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <IconChevronRight className="h-5 w-5" />
                  </button>
                </div>
              )}
            </DialogContent>
          );
        })()}
    </Dialog>
  );
}

function variantSlotTime(slot: AssetVariantState["slots"][number]): number {
  const raw = slot.updatedAt ?? slot.createdAt ?? "";
  const time = Date.parse(raw);
  return Number.isNaN(time) ? 0 : time;
}

function assetVariantStateKey(scopeId?: string | null) {
  const scopedId = typeof scopeId === "string" ? scopeId.trim() : "";
  return scopedId ? `asset-variants:${scopedId}` : "asset-variants";
}

function referenceRoleForLibraryCandidate(asset?: Asset | null) {
  if (asset?.mediaType === "video" || asset?.mimeType?.startsWith("video/")) {
    return "video_reference";
  }
  return "style_reference";
}

function setLibraryAssetSavedInCache(
  queryClient: ReturnType<typeof useQueryClient>,
  libraryId: string,
  assetId: string,
  savedAsset: unknown,
) {
  queryClient.setQueryData(
    ["action", "get-library", { id: libraryId }],
    (current: any) => {
      if (!current || !Array.isArray(current.assets)) return current;
      let changed = false;
      const assets = current.assets.map((asset: any) => {
        if (asset.id !== assetId) return asset;
        changed = true;
        return {
          ...asset,
          ...(savedAsset && typeof savedAsset === "object" ? savedAsset : {}),
          status: "saved",
        };
      });
      return changed ? { ...current, assets } : current;
    },
  );
}

function setLibraryAssetReferenceInCache(
  queryClient: ReturnType<typeof useQueryClient>,
  libraryId: string,
  assetId: string,
) {
  queryClient.setQueryData(
    ["action", "get-library", { id: libraryId }],
    (current: any) => {
      if (!current || !Array.isArray(current.assets)) return current;
      let changed = false;
      const assets = current.assets.map((asset: any) => {
        if (asset.id !== assetId) return asset;
        changed = true;
        return {
          ...asset,
          status: "reference",
          role: referenceRoleForLibraryCandidate(asset),
          updatedAt: new Date().toISOString(),
        };
      });
      return changed ? { ...current, assets } : current;
    },
  );
}

function updateLibraryVariantSlotsInCache(
  queryClient: ReturnType<typeof useQueryClient>,
  shouldRemove: (slot: any) => boolean,
  variantScopeId?: string | null,
) {
  const stateKeys = new Set([
    "asset-variants",
    assetVariantStateKey(variantScopeId),
  ]);
  for (const stateKey of stateKeys) {
    queryClient.setQueryData(["app-state", stateKey], (current: any) => {
      if (!current || !Array.isArray(current.slots)) return current;
      const slots = current.slots.filter((slot: any) => !shouldRemove(slot));
      if (slots.length === current.slots.length) return current;
      if (slots.length === 0) return null;
      return { ...current, slots, updatedAt: new Date().toISOString() };
    });
  }
}

function removeLibraryVariantSlotFromCache(
  queryClient: ReturnType<typeof useQueryClient>,
  slot: VariantSlot,
  variantScopeId?: string | null,
) {
  updateLibraryVariantSlotsInCache(
    queryClient,
    (candidate) =>
      candidate.slotId === slot.slotId ||
      (!!slot.assetId && candidate.assetId === slot.assetId),
    variantScopeId,
  );
}

function LibraryCandidateStage({
  activeLibraryId = null,
  foldersByLibraryId = {},
  variantScopeId = null,
  onUseAsset,
  inline = false,
}: {
  activeLibraryId?: string | null;
  foldersByLibraryId?: Record<string, any[]>;
  variantScopeId?: string | null;
  onUseAsset?: (asset: Asset) => void;
  inline?: boolean;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [savingCandidateSlotId, setSavingCandidateSlotId] = useState<
    string | null
  >(null);
  const [promotingReferenceKeys, setPromotingReferenceKeys] = useState<
    Set<string>
  >(() => new Set());
  const { data: variants } = useQuery({
    queryKey: ["app-state", assetVariantStateKey(variantScopeId)],
    queryFn: ({ signal }) => {
      return readClientAppState<AssetVariantState>(
        assetVariantStateKey(variantScopeId),
        { signal },
      );
    },
    refetchInterval: 1000,
  });
  const isAllAssetsStage = !activeLibraryId;
  const liveLibraryId = activeLibraryId ?? variants?.libraryId ?? null;
  const liveVariantsForLibrary =
    liveLibraryId && variants?.libraryId === liveLibraryId ? variants : null;
  const { data: libraryData } = useActionQuery(
    "get-library",
    { id: activeLibraryId ?? "" } as any,
    { enabled: Boolean(activeLibraryId) } as any,
  ) as { data?: { library?: Library; assets?: Asset[]; folders?: any[] } };
  const { data: allCandidateData } = useActionQuery(
    "list-assets",
    { includeCandidates: true, status: "candidate" } as any,
    { enabled: isAllAssetsStage } as any,
  ) as { data?: { assets?: Asset[] } };
  const saveGenerated = useActionMutation("save-generated-image");
  const updateAsset = useActionMutation("update-asset");
  const libraryAssets = isAllAssetsStage
    ? (allCandidateData?.assets ?? [])
    : (libraryData?.assets ?? []);
  const assetById = useMemo(
    () => new Map(libraryAssets.map((asset) => [asset.id, asset])),
    [libraryAssets],
  );
  const slots = useMemo(
    () =>
      (liveVariantsForLibrary?.slots ?? [])
        .filter((slot) => ["pending", "ready", "failed"].includes(slot.status))
        .slice()
        .sort(
          (left, right) =>
            variantSlotTime(right) - variantSlotTime(left) ||
            right.slotId.localeCompare(left.slotId),
        ),
    [liveVariantsForLibrary?.slots],
  );
  const liveAssetIds = useMemo(
    () =>
      new Set(
        slots
          .map((slot) => slot.assetId)
          .filter((assetId): assetId is string => Boolean(assetId)),
      ),
    [slots],
  );
  const draftAssets = useMemo(
    () =>
      libraryAssets
        .filter(
          (asset) =>
            asset.status === "candidate" &&
            isGeneratedAsset(asset) &&
            !liveAssetIds.has(asset.id),
        )
        .slice()
        .sort((left, right) => String(right.id).localeCompare(String(left.id))),
    [libraryAssets, liveAssetIds],
  );
  const totalCount = slots.length + draftAssets.length;

  if (totalCount === 0) return null;
  const stageLibraryId = liveLibraryId ?? draftAssets[0]?.libraryId ?? null;
  if (!stageLibraryId) return null;

  function invalidateStage(
    libraryIdToInvalidate: string | null = stageLibraryId,
  ) {
    void queryClient.invalidateQueries({
      queryKey: ["app-state"],
      refetchType: "active",
    });
    if (libraryIdToInvalidate) {
      void queryClient.invalidateQueries({
        queryKey: ["action", "get-library", { id: libraryIdToInvalidate }],
        refetchType: "active",
      });
    }
    void queryClient.invalidateQueries({
      queryKey: ["action", "get-library"],
      refetchType: "active",
    });
    void queryClient.invalidateQueries({
      queryKey: ["action", "list-assets"],
      refetchType: "active",
    });
  }

  function setReferencePromoting(key: string, promoting: boolean) {
    setPromotingReferenceKeys((current) => {
      const next = new Set(current);
      if (promoting) next.add(key);
      else next.delete(key);
      return next.size === current.size ? current : next;
    });
  }

  async function handleSaveLiveCandidate(
    slot: VariantSlot,
    folderId?: string | null,
  ) {
    if (savingCandidateSlotId || (!slot.assetId && !slot.slotId)) return;
    if (!liveLibraryId) return;
    setSavingCandidateSlotId(slot.slotId);
    try {
      const savedAsset = await saveGenerated.mutateAsync({
        assetId: slot.assetId,
        slotId: slot.slotId,
        folderId,
      } as any);
      if (slot.assetId) {
        setLibraryAssetSavedInCache(
          queryClient,
          liveLibraryId,
          slot.assetId,
          savedAsset,
        );
      }
      removeLibraryVariantSlotFromCache(queryClient, slot, variantScopeId);
      invalidateStage(liveLibraryId);
      toast.success(t("library.savedToLibrary"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("library.couldNotSaveCandidate"),
      );
    } finally {
      setSavingCandidateSlotId(null);
    }
  }

  async function handleSaveDraftCandidate(
    asset: Asset,
    folderId?: string | null,
  ) {
    if (!asset?.id || savingCandidateSlotId) return;
    const key = `draft:${asset.id}`;
    setSavingCandidateSlotId(key);
    const targetLibraryId = asset.libraryId ?? stageLibraryId;
    try {
      const savedAsset = await saveGenerated.mutateAsync({
        assetId: asset.id,
        folderId,
      } as any);
      setLibraryAssetSavedInCache(
        queryClient,
        targetLibraryId,
        asset.id,
        savedAsset,
      );
      invalidateStage(targetLibraryId);
      toast.success(t("library.savedToLibrary"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("library.couldNotSaveDraft"),
      );
    } finally {
      setSavingCandidateSlotId(null);
    }
  }

  async function handleMoveToReferences(asset: Asset, slot?: VariantSlot) {
    const key = slot?.slotId
      ? `slot:${slot.slotId}`
      : asset?.id
        ? `asset:${asset.id}`
        : "";
    if (!asset?.id || !key || promotingReferenceKeys.has(key)) return;
    setReferencePromoting(key, true);
    const targetLibraryId = asset.libraryId ?? stageLibraryId;
    try {
      await updateAsset.mutateAsync({
        id: asset.id,
        status: "reference",
        role: referenceRoleForLibraryCandidate(asset),
      } as any);
      setLibraryAssetReferenceInCache(queryClient, targetLibraryId, asset.id);
      updateLibraryVariantSlotsInCache(
        queryClient,
        (candidate) =>
          candidate.assetId === asset.id ||
          (!!slot?.slotId && candidate.slotId === slot.slotId),
        variantScopeId,
      );
      invalidateStage(targetLibraryId);
      toast.success(t("library.addedToReferences"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("library.couldNotAddToReferences"),
      );
    } finally {
      setReferencePromoting(key, false);
    }
  }

  function handleMoveLiveCandidateToReferences(slot: VariantSlot) {
    if (!slot.assetId) return;
    void handleMoveToReferences(
      assetById.get(slot.assetId) ?? {
        id: slot.assetId,
        libraryId: liveLibraryId ?? stageLibraryId,
        mediaType: "image",
        status: "candidate",
      },
      slot,
    );
  }

  function handleUseLiveCandidate(slot: VariantSlot) {
    if (!slot.assetId || !onUseAsset) return;
    onUseAsset(
      assetById.get(slot.assetId) ?? {
        id: slot.assetId,
        libraryId: liveLibraryId ?? stageLibraryId,
        mediaType: "image",
        status: "candidate",
        title: t("library.readyCandidate"),
        previewUrl: slot.previewUrl,
        thumbnailUrl: slot.thumbnailUrl,
        downloadUrl: slot.previewUrl,
        url: slot.previewUrl,
      },
    );
  }

  return (
    <section
      className={cn(
        "min-w-0 overflow-hidden",
        inline
          ? "mb-3"
          : "shrink-0 border-b border-border bg-background px-3 py-3 sm:px-4 md:px-6",
      )}
    >
      <LiveCandidatesStage
        slots={slots}
        draftAssets={draftAssets}
        libraryId={stageLibraryId}
        folders={
          libraryData?.folders ?? foldersByLibraryId[stageLibraryId] ?? []
        }
        foldersByLibraryId={foldersByLibraryId}
        savingSlotId={savingCandidateSlotId}
        promotingReferenceKeys={promotingReferenceKeys}
        onSave={(slot, folderId) => {
          void handleSaveLiveCandidate(slot, folderId);
        }}
        onSaveDraft={(asset, folderId) => {
          void handleSaveDraftCandidate(asset, folderId);
        }}
        onMoveToReferences={handleMoveLiveCandidateToReferences}
        onMoveDraftToReferences={(asset) => {
          void handleMoveToReferences(asset);
        }}
        onUse={onUseAsset ? handleUseLiveCandidate : undefined}
        onUseDraft={onUseAsset}
      />
    </section>
  );
}

function useLibraryRouteSelectedId(explicitId: string | null) {
  const params = useParams();
  const location = useLocation();

  return useMemo(() => {
    if (explicitId) return explicitId;
    if (typeof params.id === "string" && params.id.trim()) return params.id;

    const segments = location.pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => {
        try {
          return decodeURIComponent(segment);
        } catch {
          return segment;
        }
      });
    const libraryIndex = segments.lastIndexOf("library");
    const nextSegment =
      libraryIndex >= 0 ? segments[libraryIndex + 1] : undefined;
    return nextSegment?.trim() || null;
  }, [explicitId, location.pathname, params.id]);
}

export function LibraryWorkspace({
  selectedLibraryId = null,
}: {
  selectedLibraryId?: string | null;
}) {
  const navigate = useNavigate();
  const routeSelectedLibraryId = useLibraryRouteSelectedId(selectedLibraryId);
  const [createOpen, setCreateOpen] = useState(false);
  const { data, isLoading } = useActionQuery("list-libraries", {
    includeFolders: true,
  } as any);
  const libraries = ((data as any)?.libraries ?? []) as ImageLibrarySummary[];
  const foldersByLibraryId = useMemo(() => {
    const result: Record<string, any[]> = {};
    for (const library of libraries) {
      result[library.id] = Array.isArray(library.folders)
        ? library.folders
        : [];
    }
    return result;
  }, [libraries]);
  const hasLibraries = isLoading || libraries.length > 0;
  const currentLibrary = useMemo(
    () =>
      routeSelectedLibraryId
        ? libraries.find((library) => library.id === routeSelectedLibraryId)
        : null,
    [libraries, routeSelectedLibraryId],
  );

  useEffect(() => {
    if (!routeSelectedLibraryId || !currentLibrary?.title) return;
    insertAgentComposerReference({
      label: currentLibrary.title,
      icon: "folder",
      source: "assets",
      refType: "brand-kit",
      refId: routeSelectedLibraryId,
      refPath: `/library/${encodeURIComponent(routeSelectedLibraryId)}`,
      slotKey: "brand-kit",
      slotLabel: "Brand kit",
      clearsSlots: ["preset"],
      metadata: {
        libraryId: routeSelectedLibraryId,
      },
    });
  }, [currentLibrary?.title, routeSelectedLibraryId]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <section className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <div className="h-full min-h-0 min-w-0 overflow-y-auto">
          <LibraryShellHeader
            selectedLibraryId={routeSelectedLibraryId}
            libraries={libraries}
            isLoading={isLoading}
            onCreateKit={() => setCreateOpen(true)}
          />
          {routeSelectedLibraryId || hasLibraries ? (
            <>
              <LibraryCandidateStage
                activeLibraryId={routeSelectedLibraryId}
                foldersByLibraryId={foldersByLibraryId}
              />
              <div className="min-w-0">
                {routeSelectedLibraryId ? (
                  <BrandKitDetailRoute
                    libraryId={routeSelectedLibraryId}
                    headerMode="actions"
                  />
                ) : (
                  <AllAssetsBrowser />
                )}
              </div>
            </>
          ) : (
            <EmptyLibraryStarter onCreateBlank={() => setCreateOpen(true)} />
          )}
        </div>
      </section>
      <CreateLibraryDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(library) => navigate(`/library/${library.id}`)}
      />
    </div>
  );
}

export function AssetPickerSurface() {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const searchParamsKey = searchParams.toString();
  const urlAssetTab = useMemo<AssetTab | null>(() => {
    const tab = new URLSearchParams(searchParamsKey).get("tab");
    return tab === "all" ||
      tab === "generated" ||
      tab === "drafts" ||
      tab === "references"
      ? tab
      : null;
  }, [searchParamsKey]);
  // The active tab is the only host-irrelevant search param. Exclude it from the
  // host-config key so toggling tabs (which writes `?tab=`) doesn't retrigger the
  // effect that resets media type / query / library from the URL.
  const hostParamsKey = useMemo(() => {
    const params = new URLSearchParams(searchParamsKey);
    params.delete("tab");
    return params.toString();
  }, [searchParamsKey]);
  const mcpChatBridgeActive =
    searchParamsRequestPicker(searchParams) || isEmbedMcpChatBridgeActive();
  const urlHostConfig = useMemo(() => {
    const params = new URLSearchParams(hostParamsKey);
    return {
      mediaType: normalizeMediaType(params.get("mediaType")),
      prompt: params.get("prompt") ?? undefined,
      query: params.get("q") ?? undefined,
      libraryId: params.get("libraryId") ?? undefined,
      libraryHint: params.get("libraryHint") ?? undefined,
      aspectRatio: params.get("aspectRatio") ?? undefined,
      presetId: params.get("presetId") ?? undefined,
      count: normalizeCount(params.get("count")),
      tier: normalizeTier(params.get("tier")),
      styleStrength: normalizeStyleStrength(params.get("styleStrength")),
      includeLogo: normalizeBoolean(params.get("includeLogo")),
      callerAppId: params.get("callerAppId") ?? undefined,
      layout: normalizePickerLayout(params.get("layout")),
      candidateRunIds: normalizeCandidateRunIds(
        params.getAll("candidateRunIds").length > 0
          ? params.getAll("candidateRunIds")
          : params.get("candidateRunIds"),
      ),
      autoGenerate: normalizeBoolean(params.get("autoGenerate")) ?? false,
    } satisfies HostConfig;
  }, [hostParamsKey]);
  const bridgeRef = useRef<EmbeddedAppBridge | null>(null);
  const embedded = useMemo(
    () =>
      searchParamsEnableEmbeddedLibrary(searchParams) ||
      isEmbeddedWindow() ||
      isEmbedAuthActive(),
    [searchParams],
  );
  const pickerVariantScopeId = useMemo(
    () =>
      typeof window === "undefined" ? null : `picker:${getBrowserTabId()}`,
    [],
  );
  const [hostConfig, setHostConfig] = useState<HostConfig>(() => urlHostConfig);
  const [mediaType, setMediaType] = useState<PickerMediaType>(
    () => hostConfig.mediaType ?? "image",
  );
  const [pickerLayout, setPickerLayout] = useState<PickerLayout>(
    () => hostConfig.layout ?? "default",
  );
  const [query, setQuery] = useState(() => hostConfig.query ?? "");
  const [prompt, setPrompt] = useState(() => hostConfig.prompt ?? "");
  const [aspectRatio, setAspectRatio] = useState<string>(
    () => hostConfig.aspectRatio ?? "16:9",
  );
  const [presetId, setPresetId] = useState(() => hostConfig.presetId ?? "none");
  const [count, setCount] = useState(() => hostConfig.count ?? 3);
  const [assetTab, setAssetTab] = useState<AssetTab>(urlAssetTab ?? "all");
  const [selectedLibraryId, setSelectedLibraryId] = useState(
    () => hostConfig.libraryId ?? "",
  );
  const [createdPickerLibrary, setCreatedPickerLibrary] =
    useState<Library | null>(null);
  const autoGenerateKeyRef = useRef<string | null>(null);
  const autoCreateLibraryRef = useRef(false);
  const [visibleCandidateRunIds, setVisibleCandidateRunIds] = useState<
    string[]
  >(() => hostConfig.candidateRunIds ?? []);

  useEffect(() => {
    setHostConfig((current) => ({ ...current, ...urlHostConfig }));
    setMediaType(urlHostConfig.mediaType ?? "image");
    setPickerLayout(urlHostConfig.layout ?? "default");
    setQuery(urlHostConfig.query ?? "");
    setPrompt(urlHostConfig.prompt ?? "");
    setSelectedLibraryId(urlHostConfig.libraryId ?? "");
    setAspectRatio(urlHostConfig.aspectRatio ?? "16:9");
    setPresetId(urlHostConfig.presetId ?? "none");
    setCount(urlHostConfig.count ?? 3);
    setVisibleCandidateRunIds(urlHostConfig.candidateRunIds ?? []);
  }, [urlHostConfig]);

  useEffect(() => {
    // Reset to "all" when the tab param is removed (e.g. back/forward nav)
    // since the component stays mounted across search-param changes.
    setAssetTab(urlAssetTab ?? "all");
  }, [urlAssetTab]);

  const handleAssetTabChange = useCallback(
    (value: AssetTab) => {
      setAssetTab(value);
      // Keep the tab reflected in the URL so it survives refresh/share and
      // stays consistent with the `?tab=` deep link from the home page.
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value === "all") next.delete("tab");
          else next.set("tab", value);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const librariesQuery = useActionQuery("list-libraries", {
    compact: true,
  } as any) as {
    data?: { libraries?: Library[] };
  };
  const libraryData = librariesQuery.data;
  const libraryListReady = Array.isArray(libraryData?.libraries);
  const libraries = libraryData?.libraries ?? [];
  const starterLibrary: Library = useMemo(
    () => ({
      id: STARTER_LIBRARY_ID,
      title: t("library.starterAssets"),
      description: STARTER_PRESET.description,
    }),
    [t],
  );
  const displayLibraries = libraries.length
    ? libraries
    : createdPickerLibrary
      ? [createdPickerLibrary]
      : [starterLibrary];

  useEffect(() => {
    const firstLibraryId = displayLibraries[0]?.id;
    if (!firstLibraryId) return;
    if (!selectedLibraryId) {
      setSelectedLibraryId(
        matchLibraryByHint(displayLibraries, hostConfig.libraryHint) ??
          firstLibraryId,
      );
      return;
    }
    if (!libraryListReady) return;
    const selectedLibraryExists = displayLibraries.some(
      (library) => library.id === selectedLibraryId,
    );
    if (!selectedLibraryExists) {
      setSelectedLibraryId(firstLibraryId);
    }
  }, [
    displayLibraries,
    hostConfig.libraryHint,
    libraryListReady,
    selectedLibraryId,
  ]);

  const { data: config } = useActionQuery(
    "get-image-generation-config",
    {},
  ) as {
    data?: GenerationConfig;
  };

  const usingStarterLibrary = selectedLibraryId === STARTER_LIBRARY_ID;
  const {
    data: presetData,
    isLoading: presetsLoading,
    isPending: presetsPending,
  } = useActionQuery(
    "list-generation-presets",
    { libraryId: selectedLibraryId } as any,
    { enabled: Boolean(selectedLibraryId) && !usingStarterLibrary } as any,
  ) as {
    data?: { presets?: GenerationPreset[] };
    isLoading?: boolean;
    isPending?: boolean;
  };
  const generationPresets =
    presetData?.presets?.filter((preset) => preset.mediaType !== "video") ?? [];
  const selectedPreset =
    presetId === "none"
      ? null
      : (generationPresets.find((preset) => preset.id === presetId) ?? null);
  const effectiveAspectRatio = selectedPreset?.aspectRatio || aspectRatio;
  const waitingForPresetData =
    !presetData && (presetsLoading || presetsPending);
  const waitingForRequestedPreset =
    mediaType === "image" &&
    presetId !== "none" &&
    !usingStarterLibrary &&
    Boolean(selectedLibraryId) &&
    !selectedPreset &&
    Boolean(waitingForPresetData);
  const mediaLabel = mediaType === "video" ? "video" : "image";
  const viewingDrafts = assetTab === "drafts";
  // The standalone Library "Drafts" tab mirrors the home Recent Drafts section:
  // every unsaved draft across all accessible libraries, regardless of media
  // type. The embedded picker keeps its library + media-type scope so an
  // image-only picker never surfaces video drafts.
  const draftsGlobalView = viewingDrafts && !embedded;
  const assetsParams = useMemo(
    () => ({
      libraryId: selectedLibraryId,
      mediaType,
      // Drafts are exactly generated candidates — filter them server-side
      // instead of fetching the whole library and filtering on the client.
      role: viewingDrafts ? "generated" : undefined,
      status: viewingDrafts ? "candidate" : undefined,
      query: query.trim() || undefined,
      includeCandidates:
        viewingDrafts ||
        (mediaType === "image" && visibleCandidateRunIds.length > 0),
      // The Drafts tab shows every unsaved draft, not just the latest run batch.
      candidateRunIds:
        !viewingDrafts && visibleCandidateRunIds.length > 0
          ? visibleCandidateRunIds
          : undefined,
    }),
    [
      viewingDrafts,
      mediaType,
      query,
      selectedLibraryId,
      visibleCandidateRunIds,
    ],
  );
  const { data: assetData, isLoading: assetsLoading } = useActionQuery(
    "list-assets",
    assetsParams as any,
    {
      enabled:
        Boolean(selectedLibraryId) && !usingStarterLibrary && !draftsGlobalView,
    } as any,
  ) as { data?: { assets?: Asset[] }; isLoading: boolean };
  const { data: globalDraftsData, isLoading: globalDraftsLoading } =
    useActionQuery(
      "list-draft-assets",
      { limit: 500 } as any,
      {
        enabled: draftsGlobalView,
      } as any,
    ) as { data?: { assets?: Asset[] }; isLoading: boolean };
  const starterAssets: Asset[] = useMemo(
    () =>
      STARTER_PRESET.referenceImages.map((reference) => ({
        id: `starter-${STARTER_PRESET.id}-${reference.id}`,
        libraryId: STARTER_LIBRARY_ID,
        title: reference.title,
        description: reference.description,
        altText: reference.title,
        mediaType: "image",
        mimeType: "image/webp",
        url: absoluteAssetUrl(reference.path),
        previewUrl: absoluteAssetUrl(reference.path),
        thumbnailUrl: absoluteAssetUrl(reference.path),
        downloadUrl: absoluteAssetUrl(reference.path),
      })),
    [],
  );
  const visibleStarterAssets = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return starterAssets;
    return starterAssets.filter((asset) =>
      [asset.title, asset.description, asset.altText]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [query, starterAssets]);
  const globalDrafts = useMemo(() => {
    const drafts = globalDraftsData?.assets ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return drafts;
    return drafts.filter((asset) =>
      [asset.title, asset.description, asset.prompt]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [globalDraftsData, query]);
  const allAssets = draftsGlobalView
    ? globalDrafts
    : usingStarterLibrary
      ? mediaType === "image"
        ? visibleStarterAssets
        : []
      : (assetData?.assets ?? []);
  const currentLibrary = useMemo(
    () =>
      displayLibraries.find((library) => library.id === selectedLibraryId) ??
      null,
    [displayLibraries, selectedLibraryId],
  );
  const assets = useMemo(
    () => allAssets.filter((asset) => assetMatchesTab(asset, assetTab)),
    [allAssets, assetTab],
  );
  const listLoading = draftsGlobalView ? globalDraftsLoading : assetsLoading;
  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
  const [standaloneSelection, setStandaloneSelection] = useState<ReturnType<
    typeof assetPayload
  > | null>(null);
  const [standaloneCopyOk, setStandaloneCopyOk] = useState(false);
  const [showCreatePane, setShowCreatePane] = useState(embedded);
  const standaloneSelectionText = useMemo(
    () =>
      standaloneSelection
        ? selectedAssetClipboardText(standaloneSelection)
        : "",
    [standaloneSelection],
  );
  const standaloneSelectionUrl =
    standaloneSelection?.url ??
    standaloneSelection?.downloadUrl ??
    standaloneSelection?.previewUrl;
  const canOpenStandaloneAsset =
    Boolean(standaloneSelection) &&
    standaloneSelection?.libraryId !== STARTER_LIBRARY_ID &&
    !standaloneSelection?.assetId.startsWith("starter-");
  const copyStandaloneSelection = useCallback(
    async (payload: ReturnType<typeof assetPayload>) => {
      const text = selectedAssetClipboardText(payload);
      try {
        await navigator.clipboard.writeText(text);
        setStandaloneCopyOk(true);
        toast.success(t("library.selectionCopied"));
        return true;
      } catch {
        setStandaloneCopyOk(false);
        toast.info(t("library.selectionReady"));
        return false;
      }
    },
    [t],
  );

  const postEmbeddedSelectionMessage = useCallback(
    (
      name: "chooseAsset" | "chooseImage",
      payload: ReturnType<typeof assetPayload>,
    ) => {
      try {
        return bridgeRef.current?.postMessage(name, payload) ?? false;
      } catch {
        return false;
      }
    },
    [],
  );

  const chooseAsset = (asset: Asset) => {
    const payload = assetPayload(asset, mediaType);
    if (embedded) {
      if (!mcpChatBridgeActive) {
        postEmbeddedSelectionMessage("chooseAsset", payload);
        if (payload.mediaType === "image") {
          postEmbeddedSelectionMessage("chooseImage", payload);
        }
      }
      void notifyMcpHost(payload).then((ok) => {
        if (ok) {
          toast.success(
            t("assetPicker.selectedAsset", {
              title: selectedAssetLabel(payload),
            }),
          );
        } else {
          toast.error(t("library.selectedAssetSendFailed"));
        }
      });
      return;
    }
    setStandaloneSelection(payload);
    setStandaloneCopyOk(false);
    void copyStandaloneSelection(payload);
  };

  const createPickerLibrary = useActionMutation(
    "create-library-from-preset" as any,
    {
      onSuccess: (result: any) => {
        if (!result?.id) return;
        const library = {
          id: result.id,
          title: result.title || t("library.mcpImagePicks"),
          description: result.description ?? null,
        };
        setCreatedPickerLibrary(library);
        setSelectedLibraryId(library.id);
        setQuery("");
      },
      onError: (error: Error) => {
        // Allow the auto-create effect to retry after a transient failure;
        // otherwise the picker stays stuck on "Preparing..." until reload.
        autoCreateLibraryRef.current = false;
        toast.error(error.message || t("library.couldNotPrepareImageLibrary"));
      },
    } as any,
  );
  const generateBatch = useActionMutation(
    "generate-image-batch" as any,
    {
      onSuccess: (result: any) => {
        const images = Array.isArray(result?.images) ? result.images : [];
        const generatedCount = images.filter((image: any) => image?.ok).length;
        const failedCount = images.length - generatedCount;
        setVisibleCandidateRunIds(
          images
            .map((image: any) =>
              image?.ok && typeof image.runId === "string" ? image.runId : null,
            )
            .filter((runId: string | null): runId is string => Boolean(runId)),
        );
        if (generatedCount > 0) {
          toast.success(
            `Generated ${generatedCount} image candidate${
              generatedCount === 1 ? "" : "s"
            }`,
            {
              description:
                failedCount > 0
                  ? `${failedCount} candidate${
                      failedCount === 1 ? "" : "s"
                    } failed.`
                  : "Pick the one you want to send back.",
            },
          );
          setQuery("");
        } else {
          toast.error(
            images[0]?.error ||
              "Image generation finished without usable candidates.",
          );
        }
      },
      onError: (error: Error) => {
        toast.error(error.message || "Image generation failed");
      },
    } as any,
  );
  const [chatGenerating, sendToAgent] = useAgentChatGenerating();

  const runGenerate = useCallback(() => {
    if (!selectedLibraryId || !prompt.trim()) return;
    if (waitingForRequestedPreset) return;
    if (!embedded) {
      sendToAgent({
        message: buildPickerChatHandoffPrompt({
          mediaType,
          prompt,
          count,
          aspectRatio: effectiveAspectRatio,
          libraryId: usingStarterLibrary ? null : selectedLibraryId,
          libraryTitle: usingStarterLibrary
            ? null
            : (currentLibrary?.title ?? null),
          presetId: selectedPreset?.id ?? null,
          presetTitle: selectedPreset?.title ?? null,
          tier: hostConfig.tier,
          styleStrength: hostConfig.styleStrength ?? "balanced",
          includeLogo: hostConfig.includeLogo ?? false,
        }),
        submit: true,
        openSidebar: true,
        newTab: true,
      });
      return;
    }
    setVisibleCandidateRunIds([]);
    const variantScopeId =
      pickerVariantScopeId ?? `picker:${getBrowserTabId()}`;
    generateBatch.mutate({
      libraryId: selectedLibraryId,
      presetId: selectedPreset?.id,
      variantScopeId,
      slots: Array.from({ length: count }, (_, index) => ({
        slotId: `picker-candidate-${index + 1}`,
        prompt: prompt.trim(),
        aspectRatio: effectiveAspectRatio,
        imageSize: selectedPreset?.imageSize || "2K",
        dismissible: false,
      })),
      tier: hostConfig.tier,
      styleStrength: hostConfig.styleStrength ?? "balanced",
      includeLogo: hostConfig.includeLogo ?? false,
      source: "ui",
      callerAppId: hostConfig.callerAppId,
    } as any);
  }, [
    count,
    currentLibrary?.title,
    embedded,
    effectiveAspectRatio,
    generateBatch,
    hostConfig.callerAppId,
    hostConfig.includeLogo,
    hostConfig.styleStrength,
    hostConfig.tier,
    mediaType,
    prompt,
    pickerVariantScopeId,
    sendToAgent,
    setVisibleCandidateRunIds,
    selectedLibraryId,
    selectedPreset,
    usingStarterLibrary,
    waitingForRequestedPreset,
  ]);

  useEffect(() => {
    if (!visibleCandidateRunIds.length) return;
    if (normalizeMediaType(hostConfig.mediaType) !== mediaType) {
      setVisibleCandidateRunIds([]);
      return;
    }
    if (
      hostConfig.libraryId &&
      selectedLibraryId &&
      hostConfig.libraryId !== selectedLibraryId
    ) {
      setVisibleCandidateRunIds([]);
    }
  }, [
    hostConfig.libraryId,
    hostConfig.mediaType,
    mediaType,
    selectedLibraryId,
    visibleCandidateRunIds.length,
  ]);

  useEffect(() => {
    const bridge = createEmbeddedAppBridge({
      onMessage: ({ name, payload }) => {
        if (name !== "configure") return;
        const next = normalizeHostConfig(payload);
        setHostConfig((current) => ({ ...current, ...next }));
        if (next.mediaType !== undefined) setMediaType(next.mediaType);
        if (next.layout !== undefined) setPickerLayout(next.layout);
        if (next.query !== undefined) setQuery(next.query);
        if (next.prompt !== undefined) setPrompt(next.prompt);
        if (next.libraryId !== undefined) setSelectedLibraryId(next.libraryId);
        if (next.aspectRatio !== undefined) setAspectRatio(next.aspectRatio);
        if (next.presetId !== undefined) setPresetId(next.presetId || "none");
        if (next.count !== undefined) setCount(next.count);
        if (next.candidateRunIds !== undefined) {
          setVisibleCandidateRunIds(next.candidateRunIds);
        }
      },
    });
    bridgeRef.current = bridge;
    bridge.ready({ app: "assets", mode: "picker" });
    return () => {
      bridge.destroy();
      if (bridgeRef.current === bridge) bridgeRef.current = null;
    };
  }, []);

  useEffect(() => {
    void writeClientAppState(
      `navigation:${getBrowserTabId()}`,
      {
        view: "picker",
        mediaType,
        libraryId: selectedLibraryId || null,
        query,
        prompt,
        aspectRatio,
        layout: pickerLayout,
      },
      { requestSource: "assets-picker-ui" },
    ).catch(() => {});
  }, [aspectRatio, mediaType, pickerLayout, prompt, query, selectedLibraryId]);

  const canGenerate =
    mediaType === "image" &&
    Boolean(selectedLibraryId) &&
    !usingStarterLibrary &&
    Boolean(prompt.trim()) &&
    !waitingForRequestedPreset &&
    !(embedded ? generateBatch.isPending : chatGenerating);
  const setupNeeded = mediaType === "image" && config?.configured === false;
  const setupMessage =
    typeof config?.lastIssue?.message === "string"
      ? config.lastIssue.message
      : config?.builderEnabled === false
        ? t("library.addGenerationKey")
        : t("library.connectGenerationModels");
  const needsGenerationLibrary =
    mediaType === "image" &&
    libraryListReady &&
    !libraries.length &&
    !createdPickerLibrary &&
    usingStarterLibrary;
  const preparingGenerationLibrary =
    needsGenerationLibrary && createPickerLibrary.isPending;
  const waitingForLibraries = mediaType === "image" && !libraryListReady;
  const preparingAutoLibrary =
    mediaType === "image" &&
    Boolean(prompt.trim()) &&
    (waitingForLibraries ||
      needsGenerationLibrary ||
      preparingGenerationLibrary);
  const generationButtonLabel = (
    embedded ? generateBatch.isPending : chatGenerating
  )
    ? t("library.generating")
    : waitingForRequestedPreset
      ? t("library.loadingPreset")
      : setupNeeded
        ? t("library.setupNeeded")
        : preparingAutoLibrary
          ? t("library.preparing")
          : embedded
            ? t("library.generate")
            : t("library.openChat");
  const generationStatus = preparingAutoLibrary
    ? waitingForLibraries
      ? t("library.checkingImageLibraries")
      : t("library.preparingImageLibrary")
    : embedded && generateBatch.isPending
      ? t("library.generatingCandidates")
      : !embedded && chatGenerating
        ? t("library.generating")
        : waitingForRequestedPreset
          ? t("library.loadingRequestedPreset")
          : null;

  useEffect(() => {
    if (!selectedPreset?.aspectRatio) return;
    setAspectRatio(selectedPreset.aspectRatio);
  }, [selectedPreset?.aspectRatio]);

  const prepareGenerationLibrary = useCallback(() => {
    createPickerLibrary.mutate({
      presetId: STARTER_PRESET.id,
      title: t("library.mcpImagePicks"),
      description: t("library.mcpImagePicksDescription"),
    } as any);
  }, [createPickerLibrary, t]);

  useEffect(() => {
    if (!prompt.trim()) return;
    if (mediaType !== "image") return;
    if (!needsGenerationLibrary || preparingGenerationLibrary) return;
    if (autoCreateLibraryRef.current) return;
    autoCreateLibraryRef.current = true;
    prepareGenerationLibrary();
  }, [
    mediaType,
    needsGenerationLibrary,
    prepareGenerationLibrary,
    preparingGenerationLibrary,
    prompt,
  ]);

  useEffect(() => {
    if (!hostConfig.autoGenerate) return;
    if (!prompt.trim() || mediaType !== "image") return;
    if (!embedded) return;
    if (!canGenerate || setupNeeded || generateBatch.isPending) return;
    if (waitingForRequestedPreset) return;
    const key = [
      selectedLibraryId,
      prompt.trim(),
      effectiveAspectRatio,
      presetId,
      count,
    ].join("|");
    if (autoGenerateKeyRef.current === key) return;
    autoGenerateKeyRef.current = key;
    runGenerate();
  }, [
    canGenerate,
    count,
    embedded,
    effectiveAspectRatio,
    generateBatch.isPending,
    hostConfig.autoGenerate,
    mediaType,
    presetId,
    prompt,
    runGenerate,
    selectedLibraryId,
    setupNeeded,
    waitingForRequestedPreset,
  ]);

  const verticalLayout = pickerLayout === "vertical";

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden bg-background text-foreground",
        embedded ? "h-screen w-screen" : "h-full w-full",
        verticalLayout && "assets-picker-vertical",
      )}
    >
      <header
        className={cn(
          "flex shrink-0 items-center justify-between gap-3 border-b border-border",
          verticalLayout ? "h-10 px-2" : "h-12 px-3",
        )}
      >
        <div className="min-w-0 truncate text-sm font-semibold">
          {embedded ? t("navigation.brand") : t("library.library")}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {mediaType === "image" && (
            <Button
              variant={showCreatePane ? "secondary" : "default"}
              size="sm"
              className={cn("gap-1.5", verticalLayout ? "h-7 px-2" : "h-8")}
              onClick={() => setShowCreatePane((open) => !open)}
            >
              {showCreatePane ? (
                <IconX className="h-3.5 w-3.5" />
              ) : (
                <IconPhotoPlus className="h-3.5 w-3.5" />
              )}
              <span className={verticalLayout ? "sr-only" : undefined}>
                {showCreatePane ? t("library.close") : t("library.createPane")}
              </span>
            </Button>
          )}
          {embedded && (
            <>
              <Button
                asChild
                variant="ghost"
                size="icon"
                title={t("library.openAssets")}
              >
                <a href={absoluteAppUrl("/")} target="_blank" rel="noreferrer">
                  <IconArrowUpRight className="h-4 w-4" />
                </a>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                title={t("library.close")}
                onClick={() => bridgeRef.current?.close()}
              >
                <IconX className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </header>

      {showCreatePane && mediaType === "image" && (
        <section
          className={cn(
            "shrink-0 border-b border-border",
            verticalLayout ? "px-2 py-2" : "px-3 py-3",
          )}
        >
          {mediaType === "image" ? (
            <div className="rounded-lg border border-border/80 bg-background focus-within:ring-1 focus-within:ring-ring">
              <Input
                type="text"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key !== "Enter" ||
                    event.shiftKey ||
                    event.nativeEvent.isComposing
                  ) {
                    return;
                  }
                  event.preventDefault();
                  if (canGenerate) runGenerate();
                }}
                placeholder={t("library.generateImagePlaceholder")}
                className={cn(
                  "border-0 bg-transparent px-3 leading-6 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0",
                  verticalLayout ? "h-9 py-2 text-xs" : "h-11 py-2.5",
                )}
              />
              <div
                className={cn(
                  "flex gap-1 px-2 pb-2",
                  verticalLayout ? "flex-col items-stretch" : "items-center",
                )}
              >
                <div
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-0.5 sm:gap-1",
                    verticalLayout ? "justify-between" : "justify-end",
                  )}
                >
                  <Select value={aspectRatio} onValueChange={setAspectRatio}>
                    <SelectTrigger
                      aria-label={t("brandKitDetail.aspectRatio")}
                      className={`${PICKER_INLINE_SELECT_CLASS} shrink-0`}
                    >
                      <span>{aspectRatio}</span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {ASPECT_RATIOS.map((ratio) => (
                          <SelectItem key={ratio} value={ratio}>
                            {ratio}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <Select
                    value={String(count)}
                    onValueChange={(value) => setCount(normalizeCount(value))}
                  >
                    <SelectTrigger
                      aria-label={t("assetPicker.candidateCount")}
                      className={`${PICKER_INLINE_SELECT_CLASS} shrink-0`}
                    >
                      <span>{count}x</span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {GENERATION_COUNTS.map((option) => (
                          <SelectItem key={option} value={String(option)}>
                            {option}x
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {generationPresets.length > 0 || presetId !== "none" ? (
                    <Select
                      value={presetId}
                      onValueChange={(value) => setPresetId(value)}
                    >
                      <SelectTrigger
                        aria-label={t("brandKitDetail.preset")}
                        className={`${PICKER_INLINE_SELECT_CLASS} max-w-[7.5rem] sm:max-w-[10rem]`}
                      >
                        <SelectValue placeholder={t("brandKitDetail.preset")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="none">
                            {t("brandKitDetail.noPreset")}
                          </SelectItem>
                          {generationPresets.map((preset) => (
                            <SelectItem key={preset.id} value={preset.id}>
                              {preset.title}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  ) : null}
                </div>
                <Button
                  className={cn(
                    "h-7 shrink-0 px-3 text-xs",
                    !verticalLayout && "min-w-[5.75rem]",
                  )}
                  disabled={!canGenerate}
                  onClick={runGenerate}
                >
                  {generationButtonLabel}
                </Button>
              </div>
              <div
                className={cn(
                  "-mt-1 min-h-6 px-3 pb-2 text-[11px] leading-4 text-muted-foreground",
                  !generationStatus && "invisible",
                )}
              >
                {generationStatus || t("library.ready")}
              </div>
            </div>
          ) : null}

          {setupNeeded && (
            <div className="mt-2 flex items-center justify-between gap-3 rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <span className="min-w-0 truncate">{setupMessage}</span>
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 px-2 text-xs"
              >
                <a
                  href={absoluteAppUrl("/settings")}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("library.settings")}
                </a>
              </Button>
            </div>
          )}

          {!setupNeeded && needsGenerationLibrary && (
            <div className="mt-2 flex items-center justify-between gap-3 rounded-md border border-border bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              <span className="min-w-0 truncate">
                {preparingGenerationLibrary
                  ? t("library.preparingImageLibraryCandidates")
                  : t("library.createImageLibraryToGenerate")}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7"
                onClick={prepareGenerationLibrary}
                disabled={preparingGenerationLibrary}
              >
                {preparingGenerationLibrary
                  ? t("library.preparing")
                  : t("library.createLibrary")}
              </Button>
            </div>
          )}
        </section>
      )}

      {!embedded && standaloneSelection && (
        <section className="shrink-0 overflow-hidden border-b border-border bg-muted/30 px-3 py-3">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                {selectedAssetLabel(standaloneSelection)}
              </div>
              {standaloneSelectionUrl && (
                <div className="truncate text-xs text-muted-foreground">
                  {standaloneSelectionUrl}
                </div>
              )}
            </div>
            <div className="flex w-full min-w-0 flex-wrap gap-2 sm:w-auto sm:flex-nowrap sm:justify-end">
              <Button
                variant="outline"
                size="sm"
                className="h-8 shrink-0 gap-1.5"
                onClick={() => copyStandaloneSelection(standaloneSelection)}
              >
                {standaloneCopyOk ? (
                  <IconCheck className="h-3.5 w-3.5" />
                ) : (
                  <IconClipboard className="h-3.5 w-3.5" />
                )}
                {standaloneCopyOk ? t("library.copied") : t("library.copy")}
              </Button>
              {canOpenStandaloneAsset && (
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="h-8 shrink-0 gap-1.5"
                >
                  <Link
                    to={`/asset/${encodeURIComponent(
                      standaloneSelection.assetId,
                    )}`}
                  >
                    <IconArrowUpRight className="h-3.5 w-3.5" />
                    {t("library.open")}
                  </Link>
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                title={t("library.close")}
                aria-label={t("library.close")}
                className="h-8 w-8 shrink-0"
                onClick={() => {
                  setStandaloneSelection(null);
                  setStandaloneCopyOk(false);
                }}
              >
                <IconX className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {standaloneCopyOk
              ? t("library.copiedPasteInstruction")
              : t("library.copyPasteInstruction")}
            . {t("library.tellAgentUseThis")}
          </p>
          <details className="mt-2">
            <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
              {t("library.showPasteText")}
            </summary>
            <Textarea
              readOnly
              value={standaloneSelectionText}
              className="mt-2 h-24 max-w-full resize-none border-border/70 bg-background font-mono text-[11px] leading-relaxed"
              onFocus={(event) => event.currentTarget.select()}
            />
          </details>
        </section>
      )}

      <main
        className={cn(
          "min-h-0 flex-1 overflow-y-auto",
          verticalLayout ? "p-2" : "p-3",
        )}
      >
        {displayLibraries.length > 0 && (
          <div
            className={cn(
              "mb-3 flex flex-col gap-2",
              !verticalLayout &&
                "sm:flex-row sm:items-center sm:justify-between",
            )}
          >
            <div
              className={cn(
                "flex flex-col gap-2",
                !verticalLayout && "sm:flex-row sm:items-center",
              )}
            >
              {draftsGlobalView ? (
                <div
                  className={cn(
                    "flex h-9 items-center rounded-md border border-border/70 bg-background px-3 text-sm text-muted-foreground",
                    !verticalLayout && "sm:w-48",
                  )}
                >
                  {t("library.allLibraries")}
                </div>
              ) : (
                <Select
                  value={selectedLibraryId}
                  onValueChange={setSelectedLibraryId}
                >
                  <SelectTrigger
                    className={cn(
                      "h-9 w-full border-border/70 bg-background",
                      !verticalLayout && "sm:w-48",
                    )}
                  >
                    <SelectValue placeholder={t("library.library")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {displayLibraries.map((library) => (
                        <SelectItem key={library.id} value={library.id}>
                          {library.title}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}
              {selectedLibraryId && (
                <Tabs
                  value={assetTab}
                  onValueChange={(value) =>
                    handleAssetTabChange(value as AssetTab)
                  }
                >
                  <TabsList>
                    <TabsTrigger value="all">
                      {t("library.tabsAll")}
                    </TabsTrigger>
                    <TabsTrigger value="generated">
                      {t("library.generated")}
                    </TabsTrigger>
                    <TabsTrigger value="drafts">
                      {t("library.drafts")}
                    </TabsTrigger>
                    <TabsTrigger value="references">
                      {t("library.references")}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              )}
            </div>
            {selectedLibraryId && (
              <Input
                type="search"
                value={query}
                onInput={(event) => setQuery(event.currentTarget.value)}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("library.searchMedia", { mediaLabel })}
                className={cn(
                  "h-9 border-border/70 bg-background",
                  !verticalLayout && "sm:max-w-xs",
                )}
              />
            )}
          </div>
        )}

        {mediaType === "image" &&
          selectedLibraryId &&
          !usingStarterLibrary &&
          !viewingDrafts &&
          pickerVariantScopeId && (
            <LibraryCandidateStage
              activeLibraryId={selectedLibraryId}
              variantScopeId={pickerVariantScopeId}
              onUseAsset={chooseAsset}
              inline
            />
          )}

        {!selectedLibraryId && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <Button asChild variant="outline">
              <Link to="/library">{t("library.createBrandKit")}</Link>
            </Button>
          </div>
        )}

        {selectedLibraryId && listLoading && (
          <div className="assets-library-dense-grid grid grid-cols-2 gap-3">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="aspect-square rounded-md" />
            ))}
          </div>
        )}

        {selectedLibraryId && !listLoading && assets.length === 0 && (
          <div className="flex h-full items-center justify-center text-center">
            <div className="max-w-sm text-sm text-muted-foreground">
              {draftsGlobalView
                ? query
                  ? t("library.noMatchingDrafts")
                  : t("library.noDrafts")
                : query
                  ? t("library.noMatchingLibraryAssets", { mediaLabel })
                  : t("library.noAssetsInLibrary", { mediaLabel })}
            </div>
          </div>
        )}

        {assets.length > 0 && (
          <div className="assets-library-dense-grid grid grid-cols-2 gap-3">
            {assets.map((asset) => (
              <div
                key={asset.id}
                className="group relative overflow-hidden rounded-md border border-border bg-card shadow-sm transition hover:border-primary/60 hover:shadow-md focus-within:ring-2 focus-within:ring-ring"
              >
                <button
                  type="button"
                  aria-label={t("library.selectAsset", {
                    title: assetDisplayTitle(asset),
                  })}
                  onClick={() => {
                    if (embedded) {
                      chooseAsset(asset);
                    } else {
                      setPreviewAsset(asset);
                    }
                  }}
                  title={assetDisplayTitle(asset)}
                  className="block w-full text-start focus-visible:outline-none"
                >
                  <div className="aspect-square bg-muted">
                    {asset.mediaType === "video" ||
                    asset.mimeType?.startsWith("video/") ? (
                      <video
                        src={asset.previewUrl ?? asset.downloadUrl ?? asset.url}
                        poster={asset.thumbnailUrl}
                        muted
                        playsInline
                        className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                      />
                    ) : (
                      <AssetThumbnail asset={asset} />
                    )}
                  </div>
                </button>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label={t("library.copyAsset", {
                          title: assetDisplayTitle(asset),
                        })}
                        onClick={(event) => {
                          event.stopPropagation();
                          chooseAsset(asset);
                        }}
                        className="absolute end-2 top-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full bg-background/80 text-foreground opacity-0 shadow-sm backdrop-blur transition hover:bg-primary hover:text-primary-foreground focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
                      >
                        <IconClipboard className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t("library.copyToClipboard")}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            ))}
          </div>
        )}
      </main>

      <Dialog
        open={Boolean(previewAsset)}
        onOpenChange={(open) => {
          if (!open) setPreviewAsset(null);
        }}
      >
        {previewAsset &&
          (() => {
            const previewIndex = assets.findIndex(
              (asset) => asset.id === previewAsset.id,
            );
            const hasPrev = previewIndex > 0;
            const hasNext =
              previewIndex >= 0 && previewIndex < assets.length - 1;
            const showPreviousAsset = () => {
              if (hasPrev) setPreviewAsset(assets[previewIndex - 1]);
            };
            const showNextAsset = () => {
              if (hasNext) setPreviewAsset(assets[previewIndex + 1]);
            };
            return (
              <DialogContent
                hideClose
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft") showPreviousAsset();
                  if (event.key === "ArrowRight") showNextAsset();
                }}
                className="max-w-4xl border-0 bg-transparent p-0 shadow-none"
              >
                <DialogTitle className="sr-only">
                  {assetDisplayTitle(previewAsset)}
                </DialogTitle>
                <DialogDescription className="sr-only">
                  {t("library.fullSizePreview", {
                    title: assetDisplayTitle(previewAsset),
                  })}
                </DialogDescription>
                <div className="relative">
                  <div className="absolute right-2 top-2 z-10 flex items-center gap-2">
                    <Button asChild variant="outline" size="sm">
                      <Link
                        to={`/asset/${encodeURIComponent(previewAsset.id)}`}
                      >
                        {t("library.viewDetails")}
                      </Link>
                    </Button>
                    <DialogClose
                      aria-label={t("library.closePreview")}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                    >
                      <IconX className="h-5 w-5" />
                    </DialogClose>
                  </div>
                  {previewAsset.mediaType === "video" ||
                  previewAsset.mimeType?.startsWith("video/") ? (
                    <video
                      src={
                        previewAsset.previewUrl ??
                        previewAsset.downloadUrl ??
                        previewAsset.url
                      }
                      poster={previewAsset.thumbnailUrl}
                      controls
                      autoPlay
                      playsInline
                      className="max-h-[85vh] w-full rounded-lg bg-black object-contain"
                    />
                  ) : (
                    <AssetOverlayImage asset={previewAsset} />
                  )}
                </div>
                {(hasPrev || hasNext) && (
                  <div className="mt-5 flex justify-center gap-2">
                    <button
                      type="button"
                      aria-label={t("library.previousImage")}
                      onClick={showPreviousAsset}
                      disabled={!hasPrev}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <IconChevronLeft className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      aria-label={t("library.nextImage")}
                      onClick={showNextAsset}
                      disabled={!hasNext}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <IconChevronRight className="h-5 w-5" />
                    </button>
                  </div>
                )}
              </DialogContent>
            );
          })()}
      </Dialog>
    </div>
  );
}

export default function LibraryRoute() {
  const [searchParams] = useSearchParams();
  const searchParamsKey = searchParams.toString();
  const embedded = useMemo(() => isEmbeddedWindow() || isEmbedAuthActive(), []);
  const { pickerRequested, queryLibraryId } = useMemo(() => {
    const params = new URLSearchParams(searchParamsKey);
    const requested =
      searchParamsRequestPicker(params) ||
      searchParamsEnableEmbeddedLibrary(params);
    return {
      pickerRequested: requested,
      queryLibraryId: requested ? null : params.get("libraryId"),
    };
  }, [searchParamsKey]);
  if (queryLibraryId) {
    return <LibraryWorkspace selectedLibraryId={queryLibraryId} />;
  }
  return embedded || pickerRequested ? (
    <AssetPickerSurface />
  ) : (
    <LibraryWorkspace />
  );
}
