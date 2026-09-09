import { useT } from "@agent-native/core/client/i18n";
import { useActionQuery } from "@agent-native/core/client/hooks";
import type { Document } from "@shared/api";
import type { SidebarCommandsResponse } from "@shared/sidebar-commands";
import { lazy, Suspense, useState } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useDocument,
  useMoveDocument,
  useUpdateDocument,
} from "@/hooks/use-documents";

import {
  type SidebarCommandId,
} from "./sidebar-commands";

const PreviewEditor = lazy(async () => {
  const module = await import("@/components/editor/VisualEditor");
  return { default: module.VisualEditor };
});

function PreviewSkeleton() {
  return (
    <div className="grid gap-3" aria-hidden="true">
      <Skeleton className="h-6 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  );
}

export default function SidebarCommandDialog({
  document: initialDocument,
  command,
  onClose,
  returnFocus,
}: {
  document: Document;
  command: SidebarCommandId;
  onClose: () => void;
  returnFocus: () => void;
}) {
  const t = useT();
  const query = useDocument(initialDocument.id);
  const commands = useActionQuery<SidebarCommandsResponse>(
    "get-document-sidebar-commands",
    { documentId: initialDocument.id, includeDestinations: command === "move" },
    { enabled: command !== "preview", staleTime: 0, refetchOnMount: "always", retry: false },
  );
  const document = query.data;
  const [editedTitle, setTitle] = useState<string | null>(null);
  const title = editedTitle ?? commands.data?.title ?? "";
  const [error, setError] = useState<string | null>(null);
  const update = useUpdateDocument();
  const move = useMoveDocument();
  const pending = update.isPending || move.isPending;
  const awaitingDocument = query.isLoading || (query.isFetching && !query.isFetchedAfterMount);
  const awaitingCommands = command !== "preview" && (commands.isLoading || (commands.isFetching && !commands.isFetchedAfterMount));
  const reason = commands.data?.writeReason;
  const unavailable = query.isError || !document || document.canView === false || (command !== "preview" && (commands.isError || !commands.data));
  const close = () => {
    if (!pending) onClose();
  };
  const restoreFocus = (event: Event) => {
    event.preventDefault();
    returnFocus();
  };

  async function rename() {
    if (awaitingDocument || awaitingCommands || unavailable || reason || !title.trim()) return;
    setError(null);
    try {
      const result = await update.mutateAsync({
        id: initialDocument.id,
        title: title.trim(),
      });
      if ("conflict" in result && result.conflict) {
        setError(t("sidebarCommands.changed"));
        return;
      }
      onClose();
    } catch {
      setError(t("sidebarCommands.failed"));
    }
  }

  async function moveTo(parentId: string | null) {
    if (awaitingDocument || awaitingCommands || unavailable || reason) return;
    setError(null);
    try {
      await move.mutateAsync({ id: initialDocument.id, parentId });
      onClose();
    } catch {
      setError(t("sidebarCommands.failed"));
    }
  }

  const status = awaitingDocument || awaitingCommands ? (
    <PreviewSkeleton />
  ) : unavailable ? (
    <div role="alert" className="grid gap-3">
      <p>{t("sidebarCommands.unavailable")}</p>
      <Button variant="outline" onClick={() => { void query.refetch(); if (command !== "preview") void commands.refetch(); }}>
        {t("sidebarCommands.retry")}
      </Button>
    </div>
  ) : null;

  if (command === "preview") {
    return (
      <Sheet
        open
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <SheetContent
          className="flex w-full flex-col sm:max-w-xl"
          onCloseAutoFocus={restoreFocus}
          aria-describedby={undefined}
        >
          <SheetHeader>
            <SheetTitle>
              {!unavailable && !awaitingDocument
                ? document.title || t("sidebar.untitled")
                : t("sidebarCommands.preview")}
            </SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-auto py-4">
            {status ||
              (document && (
                <>
                  <Button asChild variant="ghost" size="sm">
                    <Link to={`/page/${document.id}`} onClick={onClose}>
                      {t("sidebarCommands.openPage")}
                    </Link>
                  </Button>
                  {document.source?.path && (
                    <p
                      className="truncate py-2 text-xs text-muted-foreground"
                      title={document.source.path}
                    >
                      {document.source.path}
                    </p>
                  )}
                  <Suspense fallback={<PreviewSkeleton />}>
                    <PreviewEditor
                      documentId={document.id}
                      content={document.content}
                      contentUpdatedAt={document.updatedAt}
                      contentRevision={document.revision}
                      editable={false}
                      onChange={() => {}}
                      localFileMode={document.source?.mode === "local-files"}
                      localFilePath={document.source?.path}
                      referenceDepth={1}
                    />
                  </Suspense>
                </>
              ))}
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        onCloseAutoFocus={restoreFocus}
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>
            {t(
              command === "rename"
                ? "sidebarCommands.rename"
                : "sidebarCommands.move",
            )}
          </DialogTitle>
        </DialogHeader>
        {status ||
          (reason ? (
            <p role="alert">{t(`sidebarCommands.${reason}`)}</p>
          ) : command === "rename" ? (
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void rename();
              }}
            >
              <Input
                autoFocus
                aria-label={t("sidebarCommands.name")}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                disabled={pending}
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={close}
                  disabled={pending}
                >
                  {t("sidebarCommands.cancel")}
                </Button>
                <Button type="submit" disabled={pending || !title.trim()}>
                  {t("sidebarCommands.save")}
                </Button>
              </div>
            </form>
          ) : (
            document && (
              <MoveTargets
                document={document}
                commands={commands.data!}
                onMove={moveTo}
                pending={pending}
              />
            )
          ))}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MoveTargets({
  document,
  commands,
  onMove,
  pending,
}: {
  document: Document;
  commands: SidebarCommandsResponse;
  onMove: (id: string | null) => Promise<void>;
  pending: boolean;
}) {
  const t = useT();
  const [search, setSearch] = useState("");
  const targets = commands.destinations.filter(
    (target) =>
      target.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  return (
    <div className="grid gap-3">
      <Input
        autoFocus
        aria-label={t("sidebarCommands.destination")}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="max-h-72 overflow-auto">
        <Button
          className="w-full justify-start"
          variant="ghost"
          disabled={pending || !commands.canMoveToRoot}
          onClick={() => void onMove(null)}
        >
          {t("sidebarCommands.root")}
        </Button>
        {targets.map((target) => (
          <Button
            key={target.id}
            className="w-full justify-start"
            variant="ghost"
            disabled={pending || target.id === document.parentId}
            onClick={() => void onMove(target.id)}
          >
            <span className="truncate">
              {target.title || t("sidebar.untitled")}
            </span>
          </Button>
        ))}
      </div>
    </div>
  );
}
