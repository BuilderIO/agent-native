import { useState } from "react";
import { IconArrowLeft, IconRotate, IconLoader2 } from "@tabler/icons-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { VisualEditor } from "./VisualEditor";
import {
  useDocumentVersions,
  useRestoreDocumentVersion,
} from "@/hooks/use-document-versions";
import { toast } from "sonner";
import type { DocumentVersion } from "@shared/api";

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMs / 3_600_000);
  const diffDay = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

interface VersionHistoryPanelProps {
  documentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function VersionHistoryPanel({
  documentId,
  open,
  onOpenChange,
}: VersionHistoryPanelProps) {
  const { data: versions, isLoading } = useDocumentVersions(
    open ? documentId : null,
  );
  const restoreVersion = useRestoreDocumentVersion(documentId);
  const [selectedVersion, setSelectedVersion] =
    useState<DocumentVersion | null>(null);

  const handleRestore = async (version: DocumentVersion) => {
    try {
      await restoreVersion.mutateAsync(version.id);
      toast.success("Version restored.");
      setSelectedVersion(null);
      onOpenChange(false);
    } catch {
      toast.error("Failed to restore version.");
    }
  };

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) setSelectedVersion(null);
    onOpenChange(nextOpen);
  };

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent side="right" className="w-[85vw] max-w-[400px] p-0">
        <SheetHeader className="px-4 pt-4 pb-0">
          <SheetTitle className="text-sm font-medium">
            {selectedVersion ? (
              <button
                onClick={() => setSelectedVersion(null)}
                className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
              >
                <IconArrowLeft size={14} />
                <span>Back to history</span>
              </button>
            ) : (
              "Version history"
            )}
          </SheetTitle>
          <SheetDescription className="sr-only">
            Browse and restore previous versions of this document.
          </SheetDescription>
        </SheetHeader>

        <Separator className="mt-3" />

        {selectedVersion ? (
          <div className="flex flex-col h-[calc(100%-60px)]">
            <div className="px-4 py-3 border-b border-border">
              <p className="text-xs font-medium truncate">
                {selectedVersion.title || "Untitled"}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {new Date(selectedVersion.createdAt).toLocaleString()}
              </p>
            </div>
            <ScrollArea className="flex-1">
              <div className="px-4 py-4">
                <VisualEditor
                  content={selectedVersion.content}
                  onChange={() => {}}
                  editable={false}
                />
              </div>
            </ScrollArea>
            <div className="p-3 border-t border-border">
              <Button
                size="sm"
                className="w-full"
                onClick={() => handleRestore(selectedVersion)}
                disabled={restoreVersion.isPending}
              >
                {restoreVersion.isPending ? (
                  <IconLoader2 size={14} className="animate-spin mr-1.5" />
                ) : (
                  <IconRotate size={14} className="mr-1.5" />
                )}
                Restore this version
              </Button>
            </div>
          </div>
        ) : (
          <ScrollArea className="h-[calc(100%-60px)]">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <IconLoader2
                  size={16}
                  className="animate-spin text-muted-foreground"
                />
              </div>
            ) : !versions?.length ? (
              <div className="py-12 text-center text-xs text-muted-foreground">
                No version history yet.
                <br />
                Versions are saved automatically as you edit.
              </div>
            ) : (
              <div className="p-1.5">
                {versions.map((version) => (
                  <button
                    key={version.id}
                    onClick={() => setSelectedVersion(version)}
                    className="w-full flex items-start gap-3 px-3 py-2.5 text-left rounded-md hover:bg-accent"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">
                        {version.title || "Untitled"}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {formatRelativeTime(version.createdAt)}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        )}
      </SheetContent>
    </Sheet>
  );
}
