import { useActionQuery } from "@agent-native/core/client";
import { useParams } from "react-router";

import { assetPreviewSources } from "@/lib/asset-preview-sources";

export default function RunEmbed() {
  const { id } = useParams();
  const { data } = useActionQuery("get-generation-run", { runId: id! }) as any;
  const assets = (data?.assets ?? []) as any[];
  return (
    <div className="grid h-screen w-screen grid-cols-2 gap-2 bg-background p-2">
      {assets.map((asset: any) => (
        <img
          key={asset.id}
          src={assetPreviewSources(asset, "thumbnail")[0]}
          alt=""
          className="h-full w-full rounded-md object-cover"
        />
      ))}
    </div>
  );
}
