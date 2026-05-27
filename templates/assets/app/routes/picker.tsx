import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  createEmbeddedAppBridge,
  type EmbeddedAppBridge,
} from "@agent-native/embedding/bridge";
import {
  sendMcpAppHostMessage,
  updateMcpAppModelContext,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client";
import {
  IconArrowUpRight,
  IconLoader2,
  IconPhoto,
  IconPhotoPlus,
  IconSearch,
  IconVideo,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

const ASPECT_RATIOS = ["16:9", "1:1", "9:16", "4:3", "3:4", "21:9"] as const;
type PickerMediaType = "image" | "video";

type Asset = {
  id: string;
  libraryId: string;
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

type HostConfig = {
  mediaType?: PickerMediaType;
  prompt?: string;
  query?: string;
  libraryId?: string;
  aspectRatio?: string;
};

function normalizeMediaType(value: unknown): PickerMediaType {
  return value === "video" ? "video" : "image";
}

function normalizeHostConfig(value: unknown): HostConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return {
    mediaType:
      record.mediaType === "image" || record.mediaType === "video"
        ? record.mediaType
        : undefined,
    prompt: typeof record.prompt === "string" ? record.prompt : undefined,
    query: typeof record.query === "string" ? record.query : undefined,
    libraryId:
      typeof record.libraryId === "string" ? record.libraryId : undefined,
    aspectRatio:
      typeof record.aspectRatio === "string" ? record.aspectRatio : undefined,
  };
}

function assetPayload(asset: Asset, requestedMediaType: PickerMediaType) {
  const mediaType =
    asset.mediaType === "video" || asset.mimeType?.startsWith("video/")
      ? "video"
      : requestedMediaType;
  return {
    id: asset.id,
    assetId: asset.id,
    libraryId: asset.libraryId,
    mediaType,
    url: asset.previewUrl ?? asset.url ?? asset.downloadUrl,
    previewUrl: asset.previewUrl,
    thumbnailUrl: asset.thumbnailUrl,
    downloadUrl: asset.downloadUrl,
    embedUrl: asset.embedUrl,
    embedPath: asset.embedPath,
    altText: asset.altText ?? asset.title ?? "",
    title: asset.title ?? "",
    width: asset.width ?? null,
    height: asset.height ?? null,
    mimeType: asset.mimeType ?? null,
  };
}

function selectedAssetText(payload: ReturnType<typeof assetPayload>) {
  const url = payload.url ?? payload.downloadUrl ?? payload.previewUrl;
  return `Selected ${payload.mediaType} asset ${payload.assetId}${url ? `: ${url}` : ""}`;
}

function notifyMcpHost(payload: ReturnType<typeof assetPayload>) {
  const context = { selectedAsset: payload };
  const update = updateMcpAppModelContext({
    structuredContent: context,
    content: [{ type: "text", text: selectedAssetText(payload) }],
  });
  void Promise.resolve(update || false)
    .then((updated) => {
      if (updated) return true;
      const sent = sendMcpAppHostMessage({
        message: "Use the selected Assets item in this conversation.",
        context: JSON.stringify(context, null, 2),
      });
      return sent || false;
    })
    .catch(() => false);
}

function dimensions(asset: Asset) {
  if (!asset.width || !asset.height) return null;
  return `${asset.width} x ${asset.height}`;
}

export default function AssetPicker() {
  const [searchParams] = useSearchParams();
  const bridgeRef = useRef<EmbeddedAppBridge | null>(null);
  const [hostConfig, setHostConfig] = useState<HostConfig>(() => ({
    mediaType: normalizeMediaType(searchParams.get("mediaType")),
    prompt: searchParams.get("prompt") ?? undefined,
    query: searchParams.get("q") ?? undefined,
    libraryId: searchParams.get("libraryId") ?? undefined,
    aspectRatio: searchParams.get("aspectRatio") ?? undefined,
  }));
  const [mediaType, setMediaType] = useState<PickerMediaType>(
    () => hostConfig.mediaType ?? "image",
  );
  const [query, setQuery] = useState(() => hostConfig.query ?? "");
  const [prompt, setPrompt] = useState(() => hostConfig.prompt ?? "");
  const [aspectRatio, setAspectRatio] = useState<string>(
    () => hostConfig.aspectRatio ?? "16:9",
  );
  const [selectedLibraryId, setSelectedLibraryId] = useState(
    () => hostConfig.libraryId ?? "",
  );

  const { data: libraryData } = useActionQuery("list-libraries", {
    compact: true,
  } as any) as { data?: { libraries?: Library[] } };
  const libraries = libraryData?.libraries ?? [];

  useEffect(() => {
    if (!selectedLibraryId && libraries[0]) {
      setSelectedLibraryId(libraries[0].id);
    }
  }, [libraries, selectedLibraryId]);

  const { data: config } = useActionQuery(
    "get-image-generation-config",
    {},
  ) as {
    data?: GenerationConfig;
  };

  const selectedLibrary = libraries.find(
    (library) => library.id === selectedLibraryId,
  );
  const mediaLabel = mediaType === "video" ? "video" : "image";
  const assetsParams = useMemo(
    () => ({
      libraryId: selectedLibraryId,
      mediaType,
      query: query.trim() || undefined,
    }),
    [mediaType, query, selectedLibraryId],
  );
  const { data: assetData, isLoading: assetsLoading } = useActionQuery(
    "list-assets",
    assetsParams as any,
    { enabled: Boolean(selectedLibraryId) } as any,
  ) as { data?: { assets?: Asset[] }; isLoading: boolean };
  const assets = assetData?.assets ?? [];

  const chooseAsset = (asset: Asset) => {
    const payload = assetPayload(asset, mediaType);
    bridgeRef.current?.postMessage("chooseAsset", payload);
    if (payload.mediaType === "image") {
      bridgeRef.current?.postMessage("chooseImage", payload);
    }
    notifyMcpHost(payload);
  };

  const generate = useActionMutation(
    "generate-image" as any,
    {
      onSuccess: (asset: Asset) => {
        toast.success("Image generated");
        chooseAsset(asset);
      },
      onError: (error: Error) => {
        toast.error(error.message || "Image generation failed");
      },
    } as any,
  );

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
      },
    });
    bridgeRef.current = bridge;
    bridge.ready({ app: "assets", mode: "picker" });
    return () => {
      bridge.destroy();
      if (bridgeRef.current === bridge) bridgeRef.current = null;
    };
  }, []);

  const canGenerate =
    mediaType === "image" &&
    Boolean(selectedLibraryId) &&
    Boolean(prompt.trim()) &&
    !generate.isPending;
  const setupNeeded = mediaType === "image" && config?.configured === false;
  const setupMessage =
    typeof config?.lastIssue?.message === "string"
      ? config.lastIssue.message
      : config?.builderEnabled === false
        ? "Add a Gemini key in Settings to generate image assets."
        : "Connect Builder.io or add a Gemini key in Settings to generate image assets.";

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            {mediaType === "video" ? (
              <IconVideo className="h-4 w-4" />
            ) : (
              <IconPhoto className="h-4 w-4" />
            )}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">Assets</div>
            {selectedLibrary && (
              <div className="truncate text-xs text-muted-foreground">
                {selectedLibrary.title} - {mediaLabel}
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button asChild variant="ghost" size="icon" title="Open Assets">
            <Link to="/" target="_blank" rel="noreferrer">
              <IconArrowUpRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="Close"
            onClick={() => bridgeRef.current?.close()}
          >
            <IconX className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <section className="shrink-0 border-b border-border px-3 py-3">
        <div className="grid gap-2 md:grid-cols-[minmax(160px,220px)_1fr_auto]">
          <Select
            value={selectedLibraryId}
            onValueChange={setSelectedLibraryId}
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Library" />
            </SelectTrigger>
            <SelectContent>
              {libraries.map((library) => (
                <SelectItem key={library.id} value={library.id}>
                  {library.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${mediaLabel} assets`}
              className="h-9 pl-9"
            />
          </div>
          <Button
            variant="outline"
            className="h-9"
            onClick={() => setQuery("")}
            disabled={!query}
          >
            Clear
          </Button>
        </div>

        <div className="mt-2 grid gap-2 md:grid-cols-[1fr_140px_auto]">
          <Input
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={
              mediaType === "video"
                ? "Video generation runs through chat or actions"
                : "Generate a new image asset"
            }
            className="h-9"
            disabled={mediaType === "video"}
          />
          <Select value={aspectRatio} onValueChange={setAspectRatio}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ASPECT_RATIOS.map((ratio) => (
                <SelectItem key={ratio} value={ratio}>
                  {ratio}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            className="h-9"
            disabled={!canGenerate}
            onClick={() => {
              if (!selectedLibraryId || !prompt.trim()) return;
              generate.mutate({
                libraryId: selectedLibraryId,
                prompt: prompt.trim(),
                aspectRatio,
                imageSize: "2K",
                source: "ui",
              } as any);
            }}
          >
            {generate.isPending ? (
              <IconLoader2 className="h-4 w-4 animate-spin" />
            ) : (
              <IconPhotoPlus className="h-4 w-4" />
            )}
            Generate
          </Button>
        </div>

        {setupNeeded && (
          <div className="mt-2 flex items-center justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-950 dark:text-amber-100">
            <span className="min-w-0 truncate">{setupMessage}</span>
            <Button asChild variant="outline" size="sm" className="h-7">
              <Link to="/settings">Settings</Link>
            </Button>
          </div>
        )}
      </section>

      <main className="min-h-0 flex-1 overflow-y-auto p-3">
        {!selectedLibraryId && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <Button asChild variant="outline">
              <Link to="/libraries">Create a library</Link>
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
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <IconPhoto className="h-8 w-8 text-muted-foreground" />
            <div className="max-w-sm text-sm text-muted-foreground">
              {query
                ? `No matching ${mediaLabel} assets in this library.`
                : `No ${mediaLabel} assets in this library yet.`}
            </div>
          </div>
        )}

        {assets.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {assets.map((asset) => (
              <button
                key={asset.id}
                type="button"
                onClick={() => chooseAsset(asset)}
                className="group overflow-hidden rounded-md border border-border bg-card text-left shadow-sm transition hover:border-primary/60 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                    <img
                      src={asset.thumbnailUrl ?? asset.previewUrl}
                      alt={asset.altText ?? asset.title ?? ""}
                      className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                    />
                  )}
                </div>
                <div className="space-y-1 p-2">
                  <div className="truncate text-xs font-medium">
                    {asset.title || asset.prompt || "Untitled asset"}
                  </div>
                  {dimensions(asset) && (
                    <div className="text-[11px] text-muted-foreground">
                      {dimensions(asset)}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
