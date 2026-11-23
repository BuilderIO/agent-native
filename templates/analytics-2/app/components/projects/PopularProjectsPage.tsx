import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useState } from "react";

import { HomePopularSection } from "@/components/home/popular";

import "@/components/home/home.css";

const PAGE_SIZE = 50;

export function PopularProjectsPage() {
  const t = useT();
  const [offset, setOffset] = useState(0);
  const query = useActionQuery<{
    projects: Array<{
      id: string;
      title: string;
      allowEmbedding: boolean;
      viewCount: number;
      ownerName: string | null;
      creatorName: string | null;
      createdAt: string;
      lastEditedAt: string;
      namesUnavailable: boolean;
    }>;
    hasMore: boolean;
  }>("list-popular-projects", {
    limit: PAGE_SIZE,
    offset,
    viewCountDuration: "oneWeek",
  });
  const popular = query.isError
    ? {
        status: "error" as const,
        projects: [],
        onRetry: () => void query.refetch(),
      }
    : query.data
      ? {
          status: "ready" as const,
          projects: query.data.projects.map((project) => ({
            id: project.id,
            title: project.title.trim() || t("analytics.lists.untitledProject"),
            href: `/app/${encodeURIComponent(project.id)}/latest`,
            allowEmbedding: project.allowEmbedding,
            viewCountLabel: String(project.viewCount),
            viewCountTooltip: t("analytics.home.popularViewCount", {
              count: project.viewCount,
            }),
            information: {
              ownerName: project.ownerName,
              creatorName: project.creatorName,
              createdAt: project.createdAt,
              lastEditedAt: project.lastEditedAt,
              namesUnavailable: project.namesUnavailable,
            },
          })),
        }
      : { status: "loading" as const, projects: [] };

  return (
    <section className="ws-home ws-home-section ws-home-section--a">
      <h2 className="ws-home-section-title">
        {t("analytics.home.popularProjects")}
      </h2>
      <div className="ws-home-section-inner">
        <HomePopularSection popular={popular} />
        <div className="mt-4 flex items-center gap-2">
          {offset > 0 ? (
            <button
              type="button"
              disabled={query.isFetching}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              {t("analytics.home.popularPrevious")}
            </button>
          ) : null}
          {query.data?.hasMore ? (
            <button
              type="button"
              disabled={query.isFetching}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              {t("analytics.home.popularNext")}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
