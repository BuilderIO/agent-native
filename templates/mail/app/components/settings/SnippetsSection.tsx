import { useT } from "@agent-native/core/client";
import {
  IconLoader2,
  IconMessage2,
  IconPencil,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useCreateSnippet,
  useDeleteSnippet,
  useSnippets,
  useUpdateSnippet,
  type Snippet,
} from "@/hooks/use-snippets";

function SnippetEditRow({
  snippet,
  onSave,
  onCancel,
  isPending,
}: {
  snippet?: Snippet;
  onSave: (name: string, body: string) => void;
  onCancel: () => void;
  isPending?: boolean;
}) {
  const t = useT();
  const [name, setName] = useState(snippet?.name ?? "");
  const [body, setBody] = useState(snippet?.body ?? "");

  const handleSave = () => {
    if (!name.trim() || !body.trim()) return;
    onSave(name.trim(), body);
  };

  return (
    <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-4 space-y-3">
      <div>
        <label className="block text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
          {t("settings.snippetName")}
        </label>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("settings.snippetNamePlaceholder")}
          className="px-3 py-1.5 text-[13px] placeholder:text-muted-foreground/40"
        />
      </div>
      <div>
        <label className="block text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
          {t("settings.snippetBody")}
        </label>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t("settings.snippetBodyPlaceholder")}
          rows={5}
          className="px-3 py-1.5 text-[13px] placeholder:text-muted-foreground/40 resize-none"
        />
      </div>
      <div className="flex items-center gap-2 pt-0.5">
        <Button
          onClick={handleSave}
          disabled={!name.trim() || !body.trim() || isPending}
          size="sm"
        >
          {isPending && <IconLoader2 className="h-3.5 w-3.5 animate-spin" />}
          {t("settings.save")}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t("settings.cancel")}
        </Button>
      </div>
    </div>
  );
}

function SnippetRow({
  snippet,
  isEditing,
  onEdit,
  onCancelEdit,
}: {
  snippet: Snippet;
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
}) {
  const t = useT();
  const updateSnippet = useUpdateSnippet();
  const deleteSnippet = useDeleteSnippet();
  const rowRef = useRef<HTMLDivElement>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    if (isEditing && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [isEditing]);

  const handleSave = (name: string, body: string) => {
    updateSnippet.mutate(
      { id: snippet.id, name, body },
      { onSuccess: onCancelEdit },
    );
  };

  const confirmDelete = () => {
    deleteSnippet.mutate(snippet.id);
    setShowDeleteConfirm(false);
  };

  if (isEditing) {
    return (
      <div ref={rowRef}>
        <SnippetEditRow
          snippet={snippet}
          onSave={handleSave}
          onCancel={onCancelEdit}
          isPending={updateSnippet.isPending}
        />
      </div>
    );
  }

  return (
    <>
      <div
        ref={rowRef}
        className="flex items-start gap-3 rounded-lg border border-border/30 bg-card px-4 py-3 group hover:border-border/60"
      >
        <div className="flex-1 min-w-0">
          <div className="mb-0.5 text-[13px] font-semibold text-foreground">
            {snippet.name}
          </div>
          <p className="text-[12px] text-muted-foreground line-clamp-2 whitespace-pre-wrap">
            {snippet.body}
          </p>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={onEdit}
                className="h-7 w-7 p-0"
              >
                <IconPencil className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("settings.editSnippet")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={deleteSnippet.isPending}
                className="h-7 w-7 p-0"
              >
                {deleteSnippet.isPending ? (
                  <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <IconTrash className="h-3.5 w-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("settings.deleteSnippet")}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settings.deleteSnippet")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings.deleteSnippetDescription", { name: snippet.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("settings.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              {t("settings.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function SnippetsSection() {
  const t = useT();
  const { data, isLoading } = useSnippets();
  const snippets = data?.snippets ?? [];
  const createSnippet = useCreateSnippet();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);

  const handleCreate = (name: string, body: string) => {
    createSnippet.mutate(
      { name, body },
      { onSuccess: () => setShowNewForm(false) },
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-[16px] font-semibold text-foreground">
            {t("settings.snippets")}
          </h2>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            {t("settings.snippetsDescription")}
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setShowNewForm(true);
            setEditingId(null);
          }}
        >
          <IconPlus className="h-3.5 w-3.5" />
          {t("settings.newSnippet")}
        </Button>
      </div>

      <div className="max-w-2xl space-y-2">
        {showNewForm && (
          <SnippetEditRow
            onSave={handleCreate}
            onCancel={() => setShowNewForm(false)}
            isPending={createSnippet.isPending}
          />
        )}

        {isLoading &&
          Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-lg border border-border/20 bg-card/50 p-3"
            >
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-3 w-full" />
              </div>
              <Skeleton className="h-7 w-7 rounded-md" />
            </div>
          ))}

        {!isLoading && snippets.length === 0 && !showNewForm && (
          <div className="rounded-lg border border-border/20 bg-card/50 py-12 text-center">
            <IconMessage2 className="h-8 w-8 text-muted-foreground/20 mx-auto mb-3" />
            <p className="text-[13px] text-muted-foreground/50">
              {t("settings.noSnippets")}
            </p>
          </div>
        )}

        {snippets.map((snippet) => (
          <SnippetRow
            key={snippet.id}
            snippet={snippet}
            isEditing={editingId === snippet.id}
            onEdit={() => {
              setEditingId(snippet.id);
              setShowNewForm(false);
            }}
            onCancelEdit={() => setEditingId(null)}
          />
        ))}
      </div>
    </div>
  );
}
