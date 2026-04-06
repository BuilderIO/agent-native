import { useEffect } from "react";
import { useNavigate } from "react-router";
import { AppLayout } from "@/components/layout/AppLayout";
import { EmptyState } from "@/components/EmptyState";
import { useDocuments } from "@/hooks/use-documents";

export function meta() {
  return [{ title: "Documents" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
    </div>
  );
}

export default function IndexRoute() {
  const navigate = useNavigate();
  const { data: documents } = useDocuments();

  // Auto-select the first favorite, or the first document if no favorites
  useEffect(() => {
    if (documents && documents.length > 0) {
      const firstFavorite = documents.find((d) => d.isFavorite);
      const target = firstFavorite ?? documents[0];
      navigate(`/page/${target.id}`, { replace: true });
    }
  }, [documents, navigate]);

  return (
    <AppLayout activeDocumentId={null}>
      <EmptyState />
    </AppLayout>
  );
}
