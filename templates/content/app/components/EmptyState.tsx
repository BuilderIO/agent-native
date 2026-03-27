import { FileText, Plus } from "lucide-react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { useCreateDocument } from "@/hooks/use-documents";
import { toast } from "sonner";

export function EmptyState() {
  const navigate = useNavigate();
  const createDocument = useCreateDocument();

  const handleCreate = async () => {
    try {
      const doc = await createDocument.mutateAsync({});
      navigate(`/${doc.id}`);
    } catch (err) {
      toast.error("Failed to create page", {
        description:
          err instanceof Error ? err.message : "Something went wrong",
      });
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center bg-background">
      <div className="text-center max-w-md px-6">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-muted mb-6">
          <FileText size={24} className="text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold text-foreground mb-2">
          No page selected
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed mb-6">
          Select a page from the sidebar or create a new one to get started.
        </p>
        <Button onClick={handleCreate} size="sm">
          <Plus size={14} className="mr-1.5" />
          New page
        </Button>
      </div>
    </div>
  );
}
