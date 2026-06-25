import {
  agentNativePath,
  appPath,
  getBrowserTabId,
  getEmbedAuthToken,
  isEmbedMcpChatBridgeActive,
  isEmbedAuthActive,
  sendMcpAppHostMessage,
  updateMcpAppModelContext,
  useActionMutation,
  useActionQuery,
  useT,
} from "@agent-native/core/client";
import {
  createEmbeddedAppBridge,
  type EmbeddedAppBridge,
} from "@agent-native/core/embedding/bridge";
import {
  IconArrowUpRight,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconClipboard,
  IconPhotoPlus,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
import { cn } from "@/lib/utils";

import type { ImageQualityTier, StyleStrength } from "../../shared/api";
import { DEFAULT_LIBRARY_PRESETS } from "../../shared/library-presets";

type AssetTab = "all" | "generated" | "references";

function isGeneratedAsset(asset: Asset) {
  const role = asset.role ?? "";
  return role === "generated" || role === "active" || role === "candidate";
}

function assetMatchesTab(asset: Asset, tab: AssetTab) {
  if (tab === "all") return true;
  if (tab === "generated") return isGeneratedAsset(asset);
  return !isGeneratedAsset(asset);
}

const ASPECT_RATIOS = ["16:9", "1:1", "9:16", "4:3", "3:4", "21:9"] as const;
const GENERATION_COUNTS = [1, 2, 3, 4, 6] as const;
const STARTER_PRESET = DEFAULT_LIBRARY_PRESETS[0];
const STARTER_LIBRARY_ID = `starter:${STARTER_PRESET.id}`;
const PICKER_INLINE_SELECT_CLASS =
  "h-7 w-auto min-w-0 max-w-full rounded-md border-0 bg-transparent px-1.5 py-1 text-xs font-medium text-muted-foreground shadow-none ring-offset-transparent transition hover:bg-accent/50 hover:text-foreground focus:ring-0 focus:ring-offset-0 sm:px-2 [&>svg]:ms-1 [&>svg]:size-3.5 [&>svg]:opacity-60";
type PickerMediaType = "image" | "video";

type Asset = {
  id: string;
  libraryId: string;
  role?: string | null;
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

const MCP_IMAGE_CONTENT_MAX_BYTES = 4 * 1024 * 1024;

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

export default function AssetPicker() {
  const t = useT();
  const [searchParams] = useSearchParams();
  const searchParamsKey = searchParams.toString();
  const mcpChatBridgeActive =
    searchParams.get("__an_mcp_chat_bridge") === "1" ||
    isEmbedMcpChatBridgeActive();
  const urlHostConfig = useMemo(() => {
    const params = new URLSearchParams(searchParamsKey);
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
      candidateRunIds: normalizeCandidateRunIds(
        params.getAll("candidateRunIds").length > 0
          ? params.getAll("candidateRunIds")
          : params.get("candidateRunIds"),
      ),
      autoGenerate: normalizeBoolean(params.get("autoGenerate")) ?? false,
    } satisfies HostConfig;
  }, [searchParamsKey]);
  const bridgeRef = useRef<EmbeddedAppBridge | null>(null);
  const embedded = useMemo(() => isEmbeddedWindow() || isEmbedAuthActive(), []);
  const [hostConfig, setHostConfig] = useState<HostConfig>(() => urlHostConfig);
  const [mediaType, setMediaType] = useState<PickerMediaType>(
    () => hostConfig.mediaType ?? "image",
  );
  const [query, setQuery] = useState(() => hostConfig.query ?? "");
  const [prompt, setPrompt] = useState(() => hostConfig.prompt ?? "");
  const [aspectRatio, setAspectRatio] = useState<string>(
    () => hostConfig.aspectRatio ?? "16:9",
  );
  const [presetId, setPresetId] = useState(() => hostConfig.presetId ?? "none");
  const [count, setCount] = useState(() => hostConfig.count ?? 3);
  const [assetTab, setAssetTab] = useState<AssetTab>("all");
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
    setQuery(urlHostConfig.query ?? "");
    setPrompt(urlHostConfig.prompt ?? "");
    setSelectedLibraryId(urlHostConfig.libraryId ?? "");
    setAspectRatio(urlHostConfig.aspectRatio ?? "16:9");
    setPresetId(urlHostConfig.presetId ?? "none");
    setCount(urlHostConfig.count ?? 3);
    setVisibleCandidateRunIds(urlHostConfig.candidateRunIds ?? []);
  }, [urlHostConfig]);

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
      title: t("assetPicker.starterAssets"),
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
    isFetching: presetsFetching,
    isPending: presetsPending,
  } = useActionQuery(
    "list-generation-presets",
    { libraryId: selectedLibraryId } as any,
    { enabled: Boolean(selectedLibraryId) && !usingStarterLibrary } as any,
  ) as {
    data?: { presets?: GenerationPreset[] };
    isLoading?: boolean;
    isFetching?: boolean;
    isPending?: boolean;
  };
  const generationPresets =
    presetData?.presets?.filter((preset) => preset.mediaType !== "video") ?? [];
  const selectedPreset =
    presetId === "none"
      ? null
      : (generationPresets.find((preset) => preset.id === presetId) ?? null);
  const effectiveAspectRatio = selectedPreset?.aspectRatio || aspectRatio;
  const waitingForRequestedPreset =
    mediaType === "image" &&
    presetId !== "none" &&
    !usingStarterLibrary &&
    Boolean(selectedLibraryId) &&
    (presetsLoading || presetsFetching || presetsPending || !selectedPreset);
  const mediaLabelText =
    mediaType === "video"
      ? t("brandKitDetail.video").toLowerCase()
      : t("brandKitDetail.image").toLowerCase();
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
            t("assetPicker.generatedCandidates", { count: generatedCount }),
            {
              description:
                failedCount > 0
                  ? t("assetPicker.failedCandidates", { count: failedCount })
                  : t("assetPicker.pickCandidate"),
            },
          );
          setQuery("");
        } else {
          toast.error(images[0]?.error || t("assetPicker.noUsableCandidates"));
        }
      },
      onError: (error: Error) => {
        toast.error(error.message || t("assetPicker.generationFailed"));
      },
    } as any,
  );
  const assetsParams = useMemo(
    () => ({
      libraryId: selectedLibraryId,
      mediaType,
      query: query.trim() || undefined,
      includeCandidates:
        mediaType === "image" && visibleCandidateRunIds.length > 0,
      candidateRunIds:
        visibleCandidateRunIds.length > 0 ? visibleCandidateRunIds : undefined,
    }),
    [mediaType, query, selectedLibraryId, visibleCandidateRunIds],
  );
  const { data: assetData, isLoading: assetsLoading } = useActionQuery(
    "list-assets",
    assetsParams as any,
    { enabled: Boolean(selectedLibraryId) && !usingStarterLibrary } as any,
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
  const allAssets = usingStarterLibrary
    ? mediaType === "image"
      ? visibleStarterAssets
      : []
    : (assetData?.assets ?? []);
  const assets = useMemo(
    () => allAssets.filter((asset) => assetMatchesTab(asset, assetTab)),
    [allAssets, assetTab],
  );
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
        toast.success(t("assetPicker.selectionCopied"));
        return true;
      } catch {
        setStandaloneCopyOk(false);
        toast.info(t("assetPicker.selectionReady"));
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
          toast.error(t("assetPicker.sendBackFailed"));
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
          title: result.title || t("assetPicker.mcpImagePicks"),
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
        toast.error(error.message || t("assetPicker.prepareLibraryFailed"));
      },
    } as any,
  );

  const runGenerate = useCallback(() => {
    if (!selectedLibraryId || !prompt.trim()) return;
    if (waitingForRequestedPreset) return;
    setVisibleCandidateRunIds([]);
    generateBatch.mutate({
      libraryId: selectedLibraryId,
      presetId: selectedPreset?.id,
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
    effectiveAspectRatio,
    generateBatch,
    hostConfig.callerAppId,
    hostConfig.includeLogo,
    hostConfig.styleStrength,
    hostConfig.tier,
    prompt,
    setVisibleCandidateRunIds,
    selectedLibraryId,
    selectedPreset,
    waitingForRequestedPreset,
  ]);

  useEffect(() => {
    const hostCandidateFilterMatches =
      hostConfig.candidateRunIds?.length &&
      normalizeMediaType(hostConfig.mediaType) === mediaType &&
      (hostConfig.libraryId ?? "") === (selectedLibraryId ?? "") &&
      (hostConfig.prompt ?? "") === prompt &&
      (hostConfig.aspectRatio ?? "16:9") === aspectRatio &&
      (hostConfig.presetId ?? "none") === presetId &&
      (hostConfig.count ?? 3) === count;
    if (hostCandidateFilterMatches) return;
    setVisibleCandidateRunIds([]);
  }, [
    aspectRatio,
    count,
    hostConfig.aspectRatio,
    hostConfig.candidateRunIds,
    hostConfig.count,
    hostConfig.callerAppId,
    hostConfig.includeLogo,
    hostConfig.libraryId,
    hostConfig.mediaType,
    hostConfig.presetId,
    hostConfig.prompt,
    hostConfig.styleStrength,
    hostConfig.tier,
    mediaType,
    presetId,
    prompt,
    selectedLibraryId,
  ]);

  useEffect(() => {
    const bridge = createEmbeddedAppBridge({
      onMessage: ({ name, payload }) => {
        if (name !== "configure") return;
        const next = normalizeHostConfig(payload);
        setHostConfig((current) => ({ ...current, ...next }));
        if (next.mediaType !== undefined) setMediaType(next.mediaType);
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
    fetch(
      agentNativePath(
        `/_agent-native/application-state/navigation:${getBrowserTabId()}`,
      ),
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-request-source": "assets-picker-ui",
        },
        body: JSON.stringify({
          view: "picker",
          mediaType,
          libraryId: selectedLibraryId || null,
          query,
          prompt,
          aspectRatio,
        }),
      },
    ).catch(() => {});
  }, [aspectRatio, mediaType, prompt, query, selectedLibraryId]);

  const canGenerate =
    mediaType === "image" &&
    Boolean(selectedLibraryId) &&
    !usingStarterLibrary &&
    Boolean(prompt.trim()) &&
    !waitingForRequestedPreset &&
    !generateBatch.isPending;
  const setupNeeded = mediaType === "image" && config?.configured === false;
  const setupMessage =
    typeof config?.lastIssue?.message === "string"
      ? config.lastIssue.message
      : config?.builderEnabled === false
        ? t("assetPicker.addGenerationKey")
        : t("assetPicker.connectGenerationModels");
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
  const generationButtonLabel = generateBatch.isPending
    ? t("brandKitDetail.generating")
    : waitingForRequestedPreset
      ? t("assetPicker.loadingPreset")
      : setupNeeded
        ? t("assetPicker.setupNeeded")
        : preparingAutoLibrary
          ? t("assetPicker.preparing")
          : t("brandKitDetail.generate");
  const generationStatus = generateBatch.isPending
    ? t("assetPicker.generatingCandidates")
    : preparingAutoLibrary
      ? waitingForLibraries
        ? t("assetPicker.checkingLibraries")
        : t("assetPicker.preparingImageLibrary")
      : waitingForRequestedPreset
        ? t("assetPicker.loadingRequestedPreset")
        : null;

  useEffect(() => {
    if (!selectedPreset?.aspectRatio) return;
    setAspectRatio(selectedPreset.aspectRatio);
  }, [selectedPreset?.aspectRatio]);

  const prepareGenerationLibrary = useCallback(() => {
    createPickerLibrary.mutate({
      presetId: STARTER_PRESET.id,
      title: t("assetPicker.mcpImagePicks"),
      description: t("assetPicker.mcpImagePicksDescription"),
    } as any);
  }, [createPickerLibrary]);

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

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden bg-background text-foreground",
        embedded ? "h-screen w-screen" : "h-full w-full",
      )}
    >
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-3">
        <div className="min-w-0 truncate text-sm font-semibold">
          {embedded ? t("navigation.brand") : t("navigation.library")}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {mediaType === "image" && (
            <Button
              variant={showCreatePane ? "secondary" : "default"}
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => setShowCreatePane((open) => !open)}
            >
              {showCreatePane ? (
                <IconX className="h-3.5 w-3.5" />
              ) : (
                <IconPhotoPlus className="h-3.5 w-3.5" />
              )}
              {showCreatePane
                ? t("brandKitDetail.close")
                : t("navigation.create")}
            </Button>
          )}
          {embedded && (
            <>
              <Button
                asChild
                variant="ghost"
                size="icon"
                title={t("assetPicker.openAssets")}
              >
                <a href={absoluteAppUrl("/")} target="_blank" rel="noreferrer">
                  <IconArrowUpRight className="h-4 w-4" />
                </a>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                title={t("brandKitDetail.close")}
                onClick={() => bridgeRef.current?.close()}
              >
                <IconX className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </header>

      {showCreatePane && mediaType === "image" && (
        <section className="shrink-0 border-b border-border px-3 py-3">
          {mediaType === "image" ? (
            <div className="mt-2 rounded-lg border border-border/80 bg-background focus-within:ring-1 focus-within:ring-ring">
              <Textarea
                autoGrow
                rows={1}
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
                placeholder={t("assetPicker.generatePlaceholder")}
                className="min-h-11 max-h-40 border-0 bg-transparent px-3 py-2.5 leading-6 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
              />
              <div className="flex items-center gap-1 px-2 pb-2">
                <div className="flex min-w-0 flex-1 items-center justify-end gap-0.5 sm:gap-1">
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
                  className="h-7 shrink-0 px-3 text-xs"
                  disabled={!canGenerate}
                  onClick={runGenerate}
                >
                  {generationButtonLabel}
                </Button>
              </div>
              {generationStatus && (
                <div className="-mt-1 px-3 pb-2 text-[11px] leading-4 text-muted-foreground">
                  {generationStatus}
                </div>
              )}
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
                  {t("navigation.settings")}
                </a>
              </Button>
            </div>
          )}

          {!setupNeeded && needsGenerationLibrary && (
            <div className="mt-2 flex items-center justify-between gap-3 rounded-md border border-border bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              <span className="min-w-0 truncate">
                {preparingGenerationLibrary
                  ? t("assetPicker.preparingGeneratedLibrary")
                  : t("assetPicker.createLibraryForCandidates")}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7"
                onClick={prepareGenerationLibrary}
                disabled={preparingGenerationLibrary}
              >
                {preparingGenerationLibrary
                  ? t("assetPicker.preparing")
                  : t("assetPicker.createLibrary")}
              </Button>
            </div>
          )}
        </section>
      )}

      {!embedded && standaloneSelection && (
        <section className="shrink-0 border-b border-border bg-muted/30 px-3 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">
                {selectedAssetLabel(standaloneSelection)}
              </div>
              {standaloneSelectionUrl && (
                <div className="truncate text-xs text-muted-foreground">
                  {standaloneSelectionUrl}
                </div>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => copyStandaloneSelection(standaloneSelection)}
              >
                {standaloneCopyOk ? (
                  <IconCheck className="h-3.5 w-3.5" />
                ) : (
                  <IconClipboard className="h-3.5 w-3.5" />
                )}
                {standaloneCopyOk
                  ? t("assetPicker.copied")
                  : t("assetPicker.copy")}
              </Button>
              {canOpenStandaloneAsset && (
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5"
                >
                  <Link
                    to={`/asset/${encodeURIComponent(
                      standaloneSelection.assetId,
                    )}`}
                  >
                    <IconArrowUpRight className="h-3.5 w-3.5" />
                    {t("brandKitDetail.open")}
                  </Link>
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                title={t("brandKitDetail.close")}
                aria-label={t("brandKitDetail.close")}
                className="h-8 w-8"
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
              ? t("assetPicker.copiedHelp")
              : t("assetPicker.copyHelp")}
          </p>
          <details className="mt-2">
            <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
              {t("assetPicker.showPasteText")}
            </summary>
            <Textarea
              readOnly
              value={standaloneSelectionText}
              className="mt-2 h-24 resize-none border-border/70 bg-background font-mono text-[11px] leading-relaxed"
              onFocus={(event) => event.currentTarget.select()}
            />
          </details>
        </section>
      )}

      <main className="min-h-0 flex-1 overflow-y-auto p-3">
        {displayLibraries.length > 0 && (
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Select
                value={selectedLibraryId}
                onValueChange={setSelectedLibraryId}
              >
                <SelectTrigger className="h-9 w-full border-border/70 bg-background sm:w-48">
                  <SelectValue placeholder={t("navigation.library")} />
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
              {selectedLibraryId && (
                <Tabs
                  value={assetTab}
                  onValueChange={(value) => setAssetTab(value as AssetTab)}
                >
                  <TabsList>
                    <TabsTrigger value="all">
                      {t("brandKitDetail.all")}
                    </TabsTrigger>
                    <TabsTrigger value="generated">
                      {t("brandKitDetail.generated")}
                    </TabsTrigger>
                    <TabsTrigger value="references">
                      {t("brandKitDetail.references")}
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
                placeholder={t("assetPicker.searchMedia", {
                  media: mediaLabelText,
                })}
                className="h-9 border-border/70 bg-background sm:max-w-xs"
              />
            )}
          </div>
        )}

        {!selectedLibraryId && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <Button asChild variant="outline">
              <Link to="/brand-kits">{t("brandKits.createDialogTitle")}</Link>
            </Button>
          </div>
        )}

        {selectedLibraryId && assetsLoading && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="aspect-square rounded-md" />
            ))}
          </div>
        )}

        {selectedLibraryId && !assetsLoading && assets.length === 0 && (
          <div className="flex h-full items-center justify-center text-center">
            <div className="max-w-sm text-sm text-muted-foreground">
              {query
                ? t("assetPicker.noMatchingAssets", {
                    media: mediaLabelText,
                  })
                : t("assetPicker.noAssetsYet", { media: mediaLabelText })}
            </div>
          </div>
        )}

        {assets.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {assets.map((asset) => (
              <div
                key={asset.id}
                className="group relative overflow-hidden rounded-md border border-border bg-card shadow-sm transition hover:border-primary/60 hover:shadow-md focus-within:ring-2 focus-within:ring-ring"
              >
                <button
                  type="button"
                  aria-label={t("assetPicker.openAsset", {
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
                        aria-label={t("assetPicker.copyAsset", {
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
                      {t("assetPicker.copyToClipboard")}
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
                  {t("assetPicker.fullSizePreview", {
                    title: assetDisplayTitle(previewAsset),
                  })}
                </DialogDescription>
                <div className="relative">
                  <div className="absolute right-2 top-2 z-10 flex items-center gap-2">
                    <Button asChild variant="outline" size="sm">
                      <Link
                        to={`/asset/${encodeURIComponent(previewAsset.id)}`}
                      >
                        {t("brandKitDetail.viewDetails")}
                      </Link>
                    </Button>
                    <DialogClose
                      aria-label={t("assetPicker.closePreview")}
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
                      aria-label={t("assetPicker.previousImage")}
                      onClick={showPreviousAsset}
                      disabled={!hasPrev}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <IconChevronLeft className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      aria-label={t("assetPicker.nextImage")}
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
