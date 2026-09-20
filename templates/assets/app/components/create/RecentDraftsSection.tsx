import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconAlertTriangle,
  IconArrowUpRight,
  IconPhoto,
} from "@tabler/icons-react";
import { useState } from "react";
import { Link } from "react-router";

import { AssetPreviewDialog } from "@/components/asset/AssetPreviewDialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type DraftAsset = {
  id: string;
  title?: string | null;
  prompt?: string | null;
  mediaType?: string | null;
  mimeType?: string | null;
  thumbnailUrl?: string | null;
  previewUrl?: string | null;
  url?: string | null;
};

const RECENT_DRAFTS_LIMIT = 5;

export function RecentDraftsSection() {
  const t = useT();
  const { data, isLoading, isError, isFetching, refetch } = useActionQuery(
    "list-draft-assets",
    {
      limit: RECENT_DRAFTS_LIMIT,
    },
  );
  const drafts = ((data as any)?.assets ?? []) as DraftAsset[];
  const [previewAsset, setPreviewAsset] = useState<DraftAsset | null>(null);

  if (isError) {
    return (
      <section className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
          <IconAlertTriangle className="size-4 shrink-0 text-destructive" />
          <span className="truncate">{t("audit.unknownError")}</span>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void refetch()}
          disabled={isFetching}
        >
          {t("brandKitDetail.refresh")}
        </Button>
      </section>
    );
  }

  if (!isLoading && drafts.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">
          {t("library.recentDrafts")}
        </h2>
        <Button asChild variant="outline" size="sm">
          <Link to="/library?tab=drafts">
            {t("library.viewAllDrafts")}
            <IconArrowUpRight size={15} className="ml-1.5" />
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
        {isLoading
          ? Array.from({ length: RECENT_DRAFTS_LIMIT }).map((_, index) => (
              <Skeleton key={index} className="aspect-square rounded-lg" />
            ))
          : drafts.map((draft) => (
              <button
                key={draft.id}
                type="button"
                onClick={() => setPreviewAsset(draft)}
                title={draft.title || draft.prompt || t("library.draftAsset")}
                className="group block overflow-hidden rounded-lg border border-border bg-card text-left shadow-sm transition hover:border-primary/60 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="aspect-square bg-muted">
                  <DraftThumbnail draft={draft} />
                </div>
              </button>
            ))}
      </div>

      <AssetPreviewDialog
        asset={previewAsset}
        assets={drafts}
        onAssetChange={(next) => setPreviewAsset(next as DraftAsset | null)}
      />
    </section>
  );
}

function DraftThumbnail({ draft }: { draft: DraftAsset }) {
  const t = useT();
  const isVideo =
    draft.mediaType === "video" || draft.mimeType?.startsWith("video/");
  const source = draft.thumbnailUrl ?? draft.previewUrl ?? draft.url ?? "";

  if (isVideo && !draft.thumbnailUrl) {
    return (
      <video
        src={draft.previewUrl ?? draft.url ?? undefined}
        muted
        playsInline
        preload="metadata"
        className="h-full w-full object-cover transition group-hover:scale-[1.02]"
      />
    );
  }

  if (!source) {
    return (
      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
        <IconPhoto className="size-5" />
      </div>
    );
  }

  return (
    <img
      src={source}
      alt={draft.title ?? draft.prompt ?? t("library.draftAsset")}
      loading="lazy"
      className="h-full w-full object-cover transition group-hover:scale-[1.02]"
    />
  );
}
