import { X } from "lucide-react";
import { useBrandAssets, useDeleteAsset } from "@/hooks/use-brand";
import type { AssetCategory } from "@shared/types";

interface AssetGridProps {
  category: AssetCategory;
}

export function AssetGrid({ category }: AssetGridProps) {
  const { data: assets, isLoading } = useBrandAssets(category);
  const deleteAsset = useDeleteAsset();

  if (isLoading) {
    return (
      <p className="text-sm text-muted-foreground">Loading assets...</p>
    );
  }

  if (!assets || assets.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No assets yet</p>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
      {assets.map((asset) => (
        <div
          key={asset.filename}
          className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-card"
        >
          <img
            src={asset.url}
            alt={asset.filename}
            className="h-full w-full object-cover"
          />
          <button
            onClick={() =>
              deleteAsset.mutate({
                category: asset.category,
                filename: asset.filename,
              })
            }
            className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-destructive group-hover:opacity-100"
            aria-label={`Delete ${asset.filename}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
