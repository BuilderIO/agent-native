import { useState } from "react";
import { useActionQuery, useActionMutation } from "@agent-native/core/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  IconFiles,
  IconSearch,
  IconTrash,
  IconEye,
  IconRefresh,
} from "@tabler/icons-react";

interface WorkspaceFileMeta {
  path: string;
  sizeBytes: number;
  contentType: string;
  updatedAt: string;
  createdAt: string;
}

interface WorkspaceFileContent {
  path: string;
  content: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function contentTypeBadgeClass(contentType: string): string {
  if (contentType.includes("json"))
    return "bg-blue-500/10 text-blue-600 dark:text-blue-400";
  if (contentType.includes("markdown") || contentType.includes("text/plain"))
    return "bg-green-500/10 text-green-600 dark:text-green-400";
  if (contentType.includes("html"))
    return "bg-orange-500/10 text-orange-600 dark:text-orange-400";
  return "bg-muted text-muted-foreground";
}

export default function WorkspaceFiles() {
  const [search, setSearch] = useState("");
  const [viewing, setViewing] = useState<WorkspaceFileMeta | null>(null);
  const [toDelete, setToDelete] = useState<WorkspaceFileMeta | null>(null);

  const {
    data: files,
    isLoading,
    refetch,
  } = useActionQuery("list-workspace-files", {}, { staleTime: 10_000 });

  const { data: fileContent, isLoading: loadingContent } = useActionQuery(
    "read-workspace-file",
    viewing ? { path: viewing.path, maxChars: 50_000 } : undefined,
    { enabled: !!viewing, staleTime: 5_000 },
  );

  const remove = useActionMutation("delete-workspace-file");

  const list = (files as WorkspaceFileMeta[] | undefined) ?? [];

  const filtered = search.trim()
    ? list.filter((f) =>
        f.path.toLowerCase().includes(search.trim().toLowerCase()),
      )
    : list;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground max-w-2xl">
        Durable scratch files the agent writes during analyses. Use these to
        inspect intermediate results, per-item memos, and large API payloads
        staged for synthesis. Files persist across conversations.
      </p>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by path…"
            className="pl-9"
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => refetch()}
          title="Refresh"
        >
          <IconRefresh className="h-4 w-4" />
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 mb-4">
              <IconFiles className="h-7 w-7 text-primary" />
            </div>
            <h3 className="text-lg font-semibold mb-2">
              {search ? "No files match" : "No workspace files yet"}
            </h3>
            <p className="text-sm text-muted-foreground max-w-md">
              {search
                ? "Try a different search term."
                : "The agent writes here during analyses — per-item memos, large API payloads, and synthesis notes. Ask it to start a batch analysis and files will appear here."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {filtered.length} file{filtered.length !== 1 ? "s" : ""}
              {search && ` matching "${search}"`}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {filtered.map((file) => (
                <div
                  key={file.path}
                  className="flex items-center justify-between px-4 py-2.5 hover:bg-muted/40 transition-colors group"
                >
                  <div className="flex-1 min-w-0 pr-3">
                    <p className="text-sm font-mono truncate" title={file.path}>
                      {file.path}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatDate(file.updatedAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge
                      variant="outline"
                      className={`text-[10px] px-1.5 py-0 border-0 ${contentTypeBadgeClass(file.contentType)}`}
                    >
                      {file.contentType.split("/")[1] ?? file.contentType}
                    </Badge>
                    <span className="text-xs text-muted-foreground w-16 text-right">
                      {formatBytes(file.sizeBytes)}
                    </span>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setViewing(file)}
                        title="View content"
                      >
                        <IconEye className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        onClick={() => setToDelete(file)}
                        title="Delete file"
                      >
                        <IconTrash className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* View content dialog */}
      <Dialog
        open={!!viewing}
        onOpenChange={(open) => !open && setViewing(null)}
      >
        <DialogContent className="sm:max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm break-all">
              {viewing?.path}
            </DialogTitle>
            <DialogDescription>
              {viewing && (
                <span>
                  {formatBytes(viewing.sizeBytes)} &bull; {viewing.contentType}{" "}
                  &bull; updated {formatDate(viewing.updatedAt)}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto min-h-0">
            {loadingContent ? (
              <div className="space-y-2 py-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-4 w-full" />
                ))}
              </div>
            ) : fileContent ? (
              <pre className="text-xs bg-muted rounded-md p-3 overflow-auto whitespace-pre-wrap break-words max-h-[55vh]">
                {(fileContent as WorkspaceFileContent).content}
              </pre>
            ) : (
              <p className="text-sm text-muted-foreground py-4">
                File not found or empty.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <AlertDialog
        open={!!toDelete}
        onOpenChange={(open) => !open && setToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete file?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-mono text-sm break-all">
                {toDelete?.path}
              </span>{" "}
              will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (toDelete) {
                  await remove.mutateAsync({ path: toDelete.path });
                  setToDelete(null);
                  refetch();
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
