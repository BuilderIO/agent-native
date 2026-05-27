import { useParams } from "react-router";
import { useActionQuery } from "@agent-native/core/client";

export default function AssetEmbed() {
  const { id } = useParams();
  const { data } = useActionQuery("get-asset", { id: id! }) as any;
  const asset = data;
  if (!asset) return <div className="h-screen bg-background" />;
  const isVideo =
    asset.mediaType === "video" || asset.mimeType?.startsWith("video/");
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background p-2">
      {isVideo ? (
        <video
          src={asset.previewUrl}
          controls
          playsInline
          className="max-h-full max-w-full rounded-md bg-black object-contain"
        />
      ) : (
        <img
          src={asset.previewUrl}
          alt={asset.altText || asset.title || ""}
          className="max-h-full max-w-full rounded-md object-contain"
        />
      )}
    </div>
  );
}
