import type { Document } from "@shared/api";
import { useEffect } from "react";
import { useNavigate } from "react-router";

import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { useDocuments } from "@/hooks/use-documents";

const SEO_TITLE =
  "Agent-Native Content - Open Source, agent-friendly Obsidian alternative";
const SEO_DESCRIPTION =
  "Open Source MDX editor for local docs, knowledge bases, and content systems, with custom blocks and agent-assisted editing.";

export function meta() {
  return [
    { title: SEO_TITLE },
    {
      name: "description",
      content: SEO_DESCRIPTION,
    },
    { property: "og:title", content: SEO_TITLE },
    { property: "og:description", content: SEO_DESCRIPTION },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: SEO_TITLE },
    { name: "twitter:description", content: SEO_DESCRIPTION },
  ];
}

function DocumentSkeleton() {
  return (
    <div className="flex-1 flex items-start justify-center bg-background overflow-hidden">
      <div className="w-full max-w-3xl px-12 pt-24 space-y-6">
        <Skeleton className="h-10 w-2/3" />
        <div className="space-y-3 pt-4">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-4/5" />
        </div>
        <div className="space-y-3 pt-6">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      </div>
    </div>
  );
}

export default function IndexRoute() {
  const navigate = useNavigate();
  const documentsQuery = useDocuments();
  const documents: Document[] = documentsQuery.data ?? [];
  const isLoading = documentsQuery.isLoading;

  // Auto-select the first favorite, or the first document if no favorites
  useEffect(() => {
    if (documents && documents.length > 0) {
      const openableDocuments = documents.filter(
        (document) => document.source?.kind !== "folder",
      );
      const firstFavorite = openableDocuments.find((d) => d.isFavorite);
      const target = firstFavorite ?? openableDocuments[0];
      if (!target) return;
      navigate(`/page/${target.id}`, { replace: true });
    }
  }, [documents, navigate]);

  // While loading, or when we have documents but haven't navigated yet,
  // show a skeleton instead of the "no page selected" empty state.
  const showSkeleton = isLoading || (documents && documents.length > 0);

  return showSkeleton ? <DocumentSkeleton /> : <EmptyState />;
}
