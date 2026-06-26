import { useActionQuery } from "@agent-native/core/client";
import { useParams } from "react-router";

import { assetPreviewSources } from "@/lib/asset-preview-sources";

export default function AssetEmbed() {
  const { id } = useParams();
  const { data } = useActionQuery("get-asset", { id: id! }) as any;
  const asset = data;
  if (!asset) return <div className="h-screen bg-background" />;
  const isVideo =
    asset.mediaType === "video" || asset.mimeType?.startsWith("video/");
  const previewUrl = assetPreviewSources(asset)[0];
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background p-2">
      {isVideo ? (
        <video
          src={previewUrl}
          controls
          playsInline
          className="max-h-full max-w-full rounded-md bg-black object-contain"
        />
      ) : (
        <img
          src={previewUrl}
          alt={asset.altText || asset.title || ""}
          className="max-h-full max-w-full rounded-md object-contain"
        />
      )}
    </div>
  );
}
