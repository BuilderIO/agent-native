import { IconFileText, IconPlus } from "@tabler/icons-react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useCreateDocument } from "@/hooks/use-documents";
import type { Document } from "@shared/api";
import { toast } from "sonner";

function nanoid(size = 12): string {
  const chars =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export function EmptyState() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const createDocument = useCreateDocument();

  const handleCreate = async () => {
    const id = nanoid();
    const now = new Date().toISOString();
    const tempDoc: Document = {
      id,
      parentId: null,
      title: "",
      content: "",
      icon: null,
      position: 9999,
      isFavorite: false,
      createdAt: now,
      updatedAt: now,
    };

    // Optimistically inject into cache and navigate immediately
    queryClient.setQueryData(
      ["action", "list-documents", undefined],
      (old: any) => {
        const docs: Document[] =
          old?.documents ?? (Array.isArray(old) ? old : []);
        return { documents: [...docs, tempDoc] };
      },
    );
    queryClient.setQueryData(["action", "get-document", { id }], tempDoc);
    navigate(`/page/${id}`);

    try {
      await createDocument.mutateAsync({ id, title: "" });
    } catch (err) {
      queryClient.invalidateQueries({ queryKey: ["action", "list-documents"] });
      queryClient.removeQueries({
        queryKey: ["action", "get-document", { id }],
      });
      navigate("/");
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
          <IconFileText size={24} className="text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold text-foreground mb-2">
          No page selected
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed mb-6">
          Select a page from the sidebar or create a new one to get started.
        </p>
        <Button onClick={handleCreate} size="sm">
          <IconPlus size={14} className="mr-1.5" />
          New page
        </Button>
      </div>
    </div>
  );
}
