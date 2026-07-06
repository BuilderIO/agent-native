import { useT } from "@agent-native/core/client";
import type { Document } from "@shared/api";
import { IconFileText, IconPlus } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useCreateDocument } from "@/hooks/use-documents";

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
  const t = useT();

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
      hideFromSearch: false,
      visibility: "private",
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
    navigate(`/page/${id}`, { flushSync: true });

    try {
      await createDocument.mutateAsync({ id, title: "" });
    } catch (err) {
      queryClient.invalidateQueries({ queryKey: ["action", "list-documents"] });
      queryClient.removeQueries({
        queryKey: ["action", "get-document", { id }],
      });
      navigate("/");
      toast.error(t("empty.createFailed"), {
        description:
          err instanceof Error ? err.message : t("empty.genericError"),
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
          {t("empty.noPageTitle")}
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed mb-6">
          {t("empty.noPageDescription")}
        </p>
        <Button onClick={handleCreate} size="sm">
          <IconPlus size={14} className="me-1.5" />
          {t("empty.newPage")}
        </Button>
      </div>
    </div>
  );
}
