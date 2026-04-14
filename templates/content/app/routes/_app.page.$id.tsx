import { useParams } from "react-router";
import { DocumentEditor } from "@/components/editor/DocumentEditor";

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>();

  return id ? (
    <DocumentEditor documentId={id} />
  ) : (
    <div className="flex-1 flex items-center justify-center text-muted-foreground">
      Document not found
    </div>
  );
}
