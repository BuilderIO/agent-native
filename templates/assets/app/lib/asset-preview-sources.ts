import { assetMediaUrl } from "./asset-urls";

type PreviewAsset = {
  mediaType?: string | null;
  mimeType?: string | null;
  previewUrl?: string | null;
  thumbnailUrl?: string | null;
  downloadUrl?: string | null;
};

export function assetPreviewSources(
  asset: PreviewAsset,
  preferred: "preview" | "thumbnail" = "preview",
): string[] {
  const isVideo =
    asset.mediaType === "video" || asset.mimeType?.startsWith("video/");
  const rawSources =
    preferred === "thumbnail"
      ? [asset.thumbnailUrl, asset.previewUrl, asset.downloadUrl]
      : isVideo
        ? [asset.previewUrl, asset.downloadUrl, asset.thumbnailUrl]
        : [asset.previewUrl, asset.thumbnailUrl, asset.downloadUrl];
  const sources = rawSources
    .map((source) => assetMediaUrl(source))
    .filter((source): source is string => Boolean(source));
  return [...new Set(sources)];
}
