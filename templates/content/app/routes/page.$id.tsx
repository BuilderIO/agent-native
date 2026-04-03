import { useParams } from "react-router";
import { AppLayout } from "@/components/layout/AppLayout";
import { DocumentEditor } from "@/components/editor/DocumentEditor";

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <AppLayout activeDocumentId={id ?? null}>
      {id ? (
        <DocumentEditor documentId={id} />
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          Document not found
        </div>
      )}
    </AppLayout>
  );
}
