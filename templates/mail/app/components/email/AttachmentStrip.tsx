import { useState } from "react";
import {
  IconAlertCircle,
  IconPaperclip,
  IconPhoto,
  IconX,
} from "@tabler/icons-react";
import type { ComposeAttachment } from "@shared/types";
import { appApiPath } from "@/lib/api-path";
import { cn } from "@/lib/utils";
import { formatFileSize } from "@/lib/upload";

function attachmentUrl(att: ComposeAttachment): string {
  return att.url.startsWith("/api/") ? appApiPath(att.url) : att.url;
}

function canPreview(att: ComposeAttachment): boolean {
  return /^image\/(?:png|jpe?g|gif|webp)$/i.test(att.mimeType);
}

export function AttachmentStrip({
  attachments,
  onRemove,
}: {
  attachments: ComposeAttachment[];
  onRemove: (attachmentId: string) => void;
}) {
  const [failedPreviews, setFailedPreviews] = useState<Set<string>>(
    () => new Set(),
  );

  if (attachments.length === 0) return null;

  return (
    <div className="flex shrink-0 flex-wrap gap-2 border-t border-border/40 px-3 py-2">
      {attachments.map((att) => {
        const previewable = canPreview(att);
        const previewFailed = failedPreviews.has(att.id);

        return (
          <div
            key={att.id}
            className="group flex min-w-0 max-w-full items-center gap-2 rounded-md border border-border bg-muted/45 p-1.5 pr-2 text-xs"
          >
            <div
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded border border-border/60 bg-background text-muted-foreground",
                previewFailed && "border-destructive/30 text-destructive",
              )}
            >
              {previewable && !previewFailed ? (
                <img
                  src={attachmentUrl(att)}
                  alt=""
                  className="h-full w-full object-cover"
                  onError={() =>
                    setFailedPreviews((prev) => {
                      const next = new Set(prev);
                      next.add(att.id);
                      return next;
                    })
                  }
                />
              ) : previewFailed ? (
                <IconAlertCircle className="h-4 w-4" />
              ) : previewable ? (
                <IconPhoto className="h-4 w-4" />
              ) : (
                <IconPaperclip className="h-4 w-4" />
              )}
            </div>
            <div className="min-w-0">
              <div className="max-w-[180px] truncate font-medium text-foreground/90">
                {att.originalName}
              </div>
              <div
                className={cn(
                  "text-[11px] text-muted-foreground",
                  previewFailed && "text-destructive",
                )}
              >
                {previewFailed
                  ? "Preview unavailable"
                  : formatFileSize(att.size)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onRemove(att.id)}
              aria-label={`Remove ${att.originalName}`}
              className="ml-0.5 rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
            >
              <IconX className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
