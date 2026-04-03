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

  // Auto-select the first document if any exist
  useEffect(() => {
    if (documents && documents.length > 0) {
      navigate(`/page/${documents[0].id}`, { replace: true });
    }
  }, [documents, navigate]);

  return (
    <AppLayout activeDocumentId={null}>
      <EmptyState />
    </AppLayout>
  );
}
