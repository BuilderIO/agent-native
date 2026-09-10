import {
  IconArrowLeft,
  IconHistory,
  IconLoader2,
  IconRestore,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { DesignThumbnail } from "@/components/design/DesignThumbnail";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useDesignVersion,
  useDesignVersions,
  useRestoreDesignVersion,
  type DesignVersionListEntry,
} from "@/hooks/use-design-versions";

interface HistoryPanelProps {
  designId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canRestore?: boolean;
  onRestored?: () => void;
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "Unknown time"; /* i18n-ignore */
  const then = new Date(dateStr).getTime();
  if (!Number.isFinite(then)) return "Unknown time"; /* i18n-ignore */
  const diffMs = Date.now() - then;
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMs / 3_600_000);
  const diffDay = Math.floor(diffMs / 86_400_000);
  if (diffMin < 1) return "Just now"; /* i18n-ignore */
  if (diffMin < 60) return `${diffMin}m ago`; /* i18n-ignore */
  if (diffHr < 24) return `${diffHr}h ago`; /* i18n-ignore */
  if (diffDay < 7) return `${diffDay}d ago`; /* i18n-ignore */
  return new Date(dateStr).toLocaleDateString();
}

function versionTitle(version: DesignVersionListEntry): string {
  if (version.label?.trim()) return version.label.trim();
  if (version.source === "chat") return "After chat edit"; /* i18n-ignore */
  return "Saved version"; /* i18n-ignore */
}

function fileCountLabel(count: number): string {
  return count === 1
    ? "1 screen" /* i18n-ignore */
    : `${count} screens`; /* i18n-ignore */
}

export function HistoryPanel({
  designId,
  open,
  onOpenChange,
  canRestore = true,
  onRestored,
}: HistoryPanelProps) {
  const queryClient = useQueryClient();
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    null,
  );
  const versionsQuery = useDesignVersions(open ? designId : null);
  const versionQuery = useDesignVersion(
    open ? designId : null,
    selectedVersionId,
  );
  const restoreVersion = useRestoreDesignVersion();

  const versions = versionsQuery.data?.versions ?? [];
  const selectedVersion = versionQuery.data;
  const previewFiles =
    selectedVersion?.files.filter(
      (file) =>
        file.fileType === "html" ||
        file.filename.endsWith(".html") ||
        file.filename.endsWith(".htm"),
    ) ?? [];

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) setSelectedVersionId(null);
    onOpenChange(nextOpen);
  };

  const handleRestore = async () => {
    if (!selectedVersionId) return;
    try {
      await restoreVersion.mutateAsync({
        designId,
        versionId: selectedVersionId,
      });
      await queryClient.invalidateQueries({
        queryKey: ["action", "get-design", { id: designId }],
      });
      await queryClient.invalidateQueries({
        queryKey: ["action", "list-design-versions"],
      });
      toast.success("Version restored" /* i18n-ignore */);
      onRestored?.();
      handleClose(false);
    } catch (error) {
      toast.error("Couldn't restore version" /* i18n-ignore */, {
        description:
          error instanceof Error
            ? error.message
            : "Please try again." /* i18n-ignore */,
      });
    }
  };

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent side="right" className="w-[92vw] max-w-[640px] p-0">
        <SheetHeader className="px-4 pt-4 pb-0">
          <SheetTitle className="flex items-center gap-2 text-sm font-medium">
            {selectedVersionId ? (
              <button
                type="button"
                onClick={() => setSelectedVersionId(null)}
                className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                <IconArrowLeft size={15} />
                <span>{"History" /* i18n-ignore */}</span>
              </button>
            ) : (
              <>
                <IconHistory
                  size={16}
                  className="text-[var(--design-editor-accent-color)]"
                />
                <span>{"History" /* i18n-ignore */}</span>
              </>
            )}
          </SheetTitle>
          <SheetDescription className="sr-only">
            {"Browse and restore saved design versions" /* i18n-ignore */}
          </SheetDescription>
        </SheetHeader>

        <Separator className="mt-3" />

        {selectedVersionId ? (
          <div className="flex h-[calc(100%-60px)] flex-col">
            <div className="border-b border-border px-4 py-3">
              {versionQuery.isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              ) : (
                <>
                  <p className="truncate text-sm font-medium">
                    {selectedVersion
                      ? versionTitle(selectedVersion)
                      : "Snapshot unavailable"}{" "}
                    {/* i18n-ignore */}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {selectedVersion
                      ? `${new Date(selectedVersion.createdAt ?? "").toLocaleString()} · ${fileCountLabel(selectedVersion.fileCount)}`
                      : "Snapshot unavailable"}{" "}
                    {/* i18n-ignore */}
                  </p>
                </>
              )}
            </div>

            <ScrollArea className="flex-1">
              <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
                {versionQuery.isLoading ? (
                  Array.from({ length: 4 }).map((_, index) => (
                    <Skeleton
                      key={index}
                      className="aspect-video w-full rounded-lg"
                    />
                  ))
                ) : previewFiles.length ? (
                  previewFiles.map((file) => (
                    <div key={file.id ?? file.filename} className="min-w-0">
                      <div className="overflow-hidden rounded-lg border border-border">
                        <DesignThumbnail html={file.content} />
                      </div>
                      <p className="mt-1.5 truncate text-[11px] text-muted-foreground">
                        {file.filename}
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="col-span-full py-12 text-center text-xs text-muted-foreground">
                    {"No screen previews in this snapshot" /* i18n-ignore */}
                  </div>
                )}
              </div>
            </ScrollArea>

            {canRestore ? (
              <div className="border-t border-border p-3">
                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => void handleRestore()}
                  disabled={restoreVersion.isPending || versionQuery.isLoading}
                >
                  {restoreVersion.isPending ? (
                    <IconLoader2 size={15} className="mr-1.5 animate-spin" />
                  ) : (
                    <IconRestore size={15} className="mr-1.5" />
                  )}
                  {"Restore this version" /* i18n-ignore */}
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <ScrollArea className="h-[calc(100%-60px)]">
            {versionsQuery.isLoading ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={index} className="h-16 w-full rounded-md" />
                ))}
              </div>
            ) : versions.length ? (
              <div className="p-2">
                {versions.map((version) => (
                  <button
                    key={version.id}
                    type="button"
                    onClick={() => setSelectedVersionId(version.id)}
                    className="w-full rounded-md px-3 py-2.5 text-left transition-colors hover:bg-accent"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-[var(--design-editor-accent-color)]" />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <p className="truncate text-sm font-medium">
                            {versionTitle(version)}
                          </p>
                          <span className="flex-shrink-0 text-[10px] text-muted-foreground">
                            {fileCountLabel(version.fileCount)}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {formatRelativeTime(version.createdAt)}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="px-6 py-14 text-center">
                <IconHistory
                  size={24}
                  className="mx-auto mb-3 text-muted-foreground/60"
                />
                <p className="text-sm font-medium">
                  {"No saved versions yet" /* i18n-ignore */}
                </p>
              </div>
            )}
          </ScrollArea>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default HistoryPanel;
