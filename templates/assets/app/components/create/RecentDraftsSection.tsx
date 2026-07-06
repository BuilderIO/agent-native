import { useActionQuery, useT } from "@agent-native/core/client";
import { Button } from "@agent-native/toolkit/ui/button";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import { IconArrowUpRight, IconPhoto } from "@tabler/icons-react";
import { Link } from "react-router";

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
  const { data, isLoading } = useActionQuery("list-draft-assets", {
    limit: RECENT_DRAFTS_LIMIT,
  });
  const drafts = ((data as any)?.assets ?? []) as DraftAsset[];

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
              <Link
                key={draft.id}
                to={`/asset/${encodeURIComponent(draft.id)}`}
                title={draft.title || draft.prompt || t("library.draftAsset")}
                className="group block overflow-hidden rounded-lg border border-border bg-card shadow-sm transition hover:border-primary/60 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="aspect-square bg-muted">
                  <DraftThumbnail draft={draft} />
                </div>
              </Link>
            ))}
      </div>
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
