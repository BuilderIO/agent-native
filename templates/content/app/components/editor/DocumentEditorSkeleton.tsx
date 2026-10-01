import { useSidebarTrigger } from "@/components/layout/sidebar-trigger";
import { Skeleton } from "@/components/ui/skeleton";
import { startupAnchor } from "@/lib/startup-timing";
import { cn } from "@/lib/utils";

import {
  DOCUMENT_EDITOR_PAGE_TITLE_SIZE_CLASS_NAME,
  DOCUMENT_EDITOR_TITLE_CLASS_NAME,
  documentEditorBodyClassName,
  documentEditorTitleRegionClassName,
  type DocumentEditorIconRow,
} from "./document-editor-layout";

// Every box here is the page editor's own box, so the title and the body start
// where the editor will draw them. While `title` is undefined the title is
// still unknown, and the body waits for it: a title that wraps would move it.
export function DocumentEditorSkeleton({
  title,
  iconRow = "add",
}: {
  title?: string | null;
  iconRow?: DocumentEditorIconRow;
}) {
  const sidebarTrigger = useSidebarTrigger();
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        {sidebarTrigger}
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          <Skeleton className="h-6 w-6 rounded-md" />
          <Skeleton className="h-4 w-36" />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Skeleton className="h-7 w-20 rounded-md" />
          <Skeleton className="h-7 w-7 rounded-md" />
          <Skeleton className="h-7 w-7 rounded-md" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className={documentEditorTitleRegionClassName(false)}>
          <div className="mb-1">
            {iconRow === "icon" ? (
              <Skeleton className="size-14 rounded-md" />
            ) : iconRow === "add" ? (
              <div className="h-7" />
            ) : null}
          </div>
          <div
            {...startupAnchor("title")}
            className={cn(
              DOCUMENT_EDITOR_TITLE_CLASS_NAME,
              DOCUMENT_EDITOR_PAGE_TITLE_SIZE_CLASS_NAME,
              "relative",
            )}
          >
            {title || (
              <>
                &nbsp;
                <Skeleton className="absolute inset-y-[20%] start-0 w-2/3" />
              </>
            )}
          </div>
        </div>
        {title === undefined ? null : (
          <div
            {...startupAnchor("body")}
            className={documentEditorBodyClassName("page")}
          >
            <div className="space-y-3 pt-1.5">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-3/4" />
            </div>
            <div className="space-y-3 pt-8">
              <Skeleton className="h-4 w-10/12" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-7/12" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
