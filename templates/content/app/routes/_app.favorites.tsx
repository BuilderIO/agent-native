import { Navigate } from "react-router";

import { QueryErrorState } from "@/components/QueryErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { useContentSpaces } from "@/hooks/use-content-spaces";

export default function FavoritesRoute() {
  const contentSpacesQuery = useContentSpaces();

  if (contentSpacesQuery.isError) {
    return (
      <QueryErrorState
        onRetry={() => void contentSpacesQuery.refetch()}
        retrying={contentSpacesQuery.isFetching}
      />
    );
  }

  const documentId = contentSpacesQuery.data?.favoritesDocumentId;
  if (!documentId) {
    return (
      <div className="min-h-0 flex-1 px-4 py-8 sm:px-8 lg:px-10">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="mt-8 h-64 w-full" />
      </div>
    );
  }

  return <Navigate to={`/page/${documentId}`} replace />;
}
