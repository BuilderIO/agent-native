import { useEffect } from "react";
import { useNavigate } from "react-router";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useDocuments } from "@/hooks/use-documents";

export function meta() {
  return [
    { title: "Agent-Native Content" },
    {
      name: "description",
      content:
        "Your AI agent creates, edits, and organizes documents alongside you in a Notion-like workspace.",
    },
  ];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full">
      <Spinner className="size-8 text-foreground" />
    </div>
  );
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
  const { data: documents, isLoading } = useDocuments();

  // Auto-select the first favorite, or the first document if no favorites
  useEffect(() => {
    if (documents && documents.length > 0) {
      const firstFavorite = documents.find((d) => d.isFavorite);
      const target = firstFavorite ?? documents[0];
      navigate(`/page/${target.id}`, { replace: true });
    }
  }, [documents, navigate]);

  // While loading, or when we have documents but haven't navigated yet,
  // show a skeleton instead of the "no page selected" empty state.
  const showSkeleton = isLoading || (documents && documents.length > 0);

  return showSkeleton ? <DocumentSkeleton /> : <EmptyState />;
}
