import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconChevronLeft,
  IconChevronRight,
  IconDownload,
  IconInfoCircle,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { assetPreviewSources } from "@/lib/asset-preview-sources";
import { assetMediaUrl } from "@/lib/asset-urls";

export type PreviewAsset = {
  id: string;
  libraryId?: string | null;
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
  url?: string | null;
  previewUrl?: string | null;
  thumbnailUrl?: string | null;
  downloadUrl?: string | null;
  folderId?: string | null;
  category?: string | null;
  model?: string | null;
  aspectRatio?: string | null;
  durationSeconds?: number | null;
  metadata?: Record<string, unknown> | null;
  lineage?: { label?: string | null } | null;
};

/**
 * The single side-panel asset preview used everywhere an asset is opened:
 * large media on the left, details on the right, a top toolbar (download,
 * details toggle, close), and previous/next navigation across `assets`.
 */
export function AssetPreviewDialog({
  asset,
  assets,
  onAssetChange,
  renderImage,
}: {
  asset: PreviewAsset | null;
  assets: PreviewAsset[];
  onAssetChange: (asset: PreviewAsset | null) => void;
  /** Optional media renderer (e.g. an embed/COEP-aware image loader). */
  renderImage?: (asset: PreviewAsset) => ReactNode;
}) {
  const t = useT();
  const exportAsset = useActionMutation("export-asset");
  const [showDetails, setShowDetails] = useState(true);
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
          const isVideo =
            asset.mediaType === "video" ||
            Boolean(asset.mimeType?.startsWith("video/"));
          const videoSrc = assetPreviewSources(asset)[0];
          const downloadAsset = () => {
            // Synthetic starter-preset assets aren't database rows, so
            // export-asset can't resolve them; download the source directly.
            if (isStarterPreviewAsset(asset)) {
              const directUrl = assetPreviewSources(asset)[0];
              if (directUrl) window.location.href = directUrl;
              else toast.error(t("assetDetail.downloadFailed"));
              return;
            }
            exportAsset.mutate(
              { assetId: asset.id },
              {
                onSuccess: (result: any) => {
                  const url =
                    assetMediaUrl(result?.downloadUrl) ?? result?.downloadUrl;
                  if (url) window.location.href = url;
                  else toast.error(t("assetDetail.downloadFailed"));
                },
                onError: () => toast.error(t("assetDetail.downloadFailed")),
              },
            );
          };
          return (
            <DialogContent
              hideClose
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") showPreviousAsset();
                if (event.key === "ArrowRight") showNextAsset();
              }}
              className="assets-preview-dialog flex max-h-[92vh] w-[94vw] max-w-6xl flex-col gap-0 overflow-hidden p-0"
            >
              <DialogTitle className="sr-only">
                {assetPreviewTitle(asset)}
              </DialogTitle>
              <DialogDescription className="sr-only">
                {t("library.fullSizePreview", {
                  title: assetPreviewTitle(asset),
                })}
              </DialogDescription>

              <div className="flex items-center justify-end gap-1 border-b border-border px-3 py-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-2"
                  disabled={exportAsset.isPending}
                  onClick={downloadAsset}
                >
                  <IconDownload className="h-4 w-4" />
                  {t("assetDetail.download")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-2"
                  aria-pressed={showDetails}
                  onClick={() => setShowDetails((value) => !value)}
                >
                  <IconInfoCircle className="h-4 w-4" />
                  {t("library.viewDetails")}
                </Button>
                <DialogClose
                  aria-label={t("library.closePreview")}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <IconX className="h-5 w-5" />
                </DialogClose>
              </div>

              <div className="flex min-h-0 flex-1 flex-col md:flex-row">
                <div className="relative flex min-h-0 flex-1 items-center justify-center bg-muted/30 p-4">
                  {isVideo ? (
                    <video
                      src={videoSrc}
                      poster={asset.thumbnailUrl ?? undefined}
                      controls
                      autoPlay
                      playsInline
                      className="max-h-[72vh] max-w-full rounded-lg bg-black object-contain"
                    />
                  ) : renderImage ? (
                    renderImage(asset)
                  ) : (
                    <AssetPreviewImage asset={asset} />
                  )}
                </div>
                {showDetails && (
                  <aside className="w-full shrink-0 overflow-y-auto border-t border-border p-5 md:w-80 md:border-l md:border-t-0">
                    <AssetPreviewDetails asset={asset} isVideo={isVideo} />
                  </aside>
                )}
              </div>

              {(hasPrev || hasNext) && (
                <div className="flex justify-center gap-2 border-t border-border py-3">
                  <button
                    type="button"
                    aria-label={t("library.previousImage")}
                    onClick={showPreviousAsset}
                    disabled={!hasPrev}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background text-foreground transition hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <IconChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    aria-label={t("library.nextImage")}
                    onClick={showNextAsset}
                    disabled={!hasNext}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background text-foreground transition hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
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

function AssetPreviewImage({ asset }: { asset: PreviewAsset }) {
  const t = useT();
  const sources = assetPreviewSources(asset);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [unavailable, setUnavailable] = useState(false);
  const sourcesKey = sources.join("\n");

  useEffect(() => {
    setSourceIndex(0);
    setUnavailable(false);
  }, [sourcesKey]);

  const src = sources[sourceIndex];
  if (!src || unavailable) {
    return (
      <div className="flex aspect-square w-full max-w-sm items-center justify-center rounded-lg border border-dashed border-border bg-background px-6 text-sm font-medium text-muted-foreground">
        {t("assetDetail.previewUnavailable")}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={asset.altText ?? asset.title ?? ""}
      className="max-h-[72vh] max-w-full rounded-lg object-contain"
      onError={() => {
        const nextIndex = sourceIndex + 1;
        if (nextIndex < sources.length) setSourceIndex(nextIndex);
        else setUnavailable(true);
      }}
    />
  );
}

function AssetPreviewDetails({
  asset,
  isVideo,
}: {
  asset: PreviewAsset;
  isVideo: boolean;
}) {
  const t = useT();
  const category = assetPreviewCategoryLabel(asset, t);
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold leading-tight tracking-tight">
          {assetPreviewTitle(asset)}
        </h2>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {asset.status ? (
            <Badge variant="secondary">{asset.status}</Badge>
          ) : null}
          {asset.role ? <Badge variant="outline">{asset.role}</Badge> : null}
          <Badge variant="outline">{isVideo ? "video" : "image"}</Badge>
          {category ? <Badge variant="outline">{category}</Badge> : null}
        </div>
      </div>
      <div className="space-y-4 text-sm">
        {isVideo ? (
          <PreviewField
            label={t("assetDetail.video")}
            value={`${asset.durationSeconds || "?"}s · ${asset.aspectRatio || "n/a"} · ${asset.model || "n/a"}`}
          />
        ) : (
          <PreviewField
            label={t("assetDetail.dimensions")}
            value={formatPreviewDimensions(asset.width, asset.height)}
          />
        )}
        <PreviewField label="MIME" value={asset.mimeType || "n/a"} />
        <PreviewField
          label={t("assetDetail.folder")}
          value={asset.folderId || t("assetDetail.unfiled")}
        />
        <PreviewField
          label={t("assetDetail.description")}
          value={
            asset.description || asset.altText || t("assetDetail.noDescription")
          }
          multiline
        />
        <PreviewField
          label={t("assetDetail.prompt")}
          value={asset.prompt || t("assetDetail.noPrompt")}
          multiline
        />
      </div>
    </div>
  );
}

function PreviewField({
  label,
  value,
  multiline,
}: {
  label: string;
  value: ReactNode;
  multiline?: boolean;
}) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={multiline ? "mt-1 whitespace-pre-wrap" : "mt-1 truncate"}>
        {value}
      </div>
    </div>
  );
}

function assetPreviewTitle(asset: PreviewAsset): string {
  return (
    asset.lineage?.label || asset.title || asset.prompt || "Untitled asset"
  );
}

function assetPreviewCategoryLabel(
  asset: PreviewAsset,
  t: (key: string, options?: Record<string, unknown>) => string,
): string | null {
  const metadata = (asset.metadata ?? {}) as Record<string, unknown>;
  if (metadata.intent === "subject" || asset.role === "subject_reference") {
    return t("assetDetail.contentOnly");
  }
  const category = (metadata.category as string | undefined) ?? asset.category;
  if (typeof category !== "string") return null;
  if (category === "style-only") return t("assetDetail.styleReference");
  if (category === "skeleton") return t("assetDetail.skeletonPlate");
  return category.replace(/-/g, " ");
}

function formatPreviewDimensions(
  width?: number | null,
  height?: number | null,
) {
  const dimensions = `${width || "?"} x ${height || "?"}`;
  if (!width || !height) return dimensions;
  const divisor = previewGcd(width, height);
  return (
    <span className="flex items-center gap-2">
      {dimensions}
      <span className="h-4 w-px bg-border" />
      {`${width / divisor}:${height / divisor}`}
    </span>
  );
}

function previewGcd(a: number, b: number): number {
  return b === 0 ? a : previewGcd(b, a % b);
}

function isStarterPreviewAsset(asset: PreviewAsset): boolean {
  return (
    asset.id.startsWith("starter-") ||
    Boolean(asset.libraryId?.startsWith("starter:"))
  );
}
