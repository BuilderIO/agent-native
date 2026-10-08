import { useSidebarTrigger } from "@/components/layout/sidebar-trigger";
import { Skeleton } from "@/components/ui/skeleton";
import { startupAnchor } from "@/lib/startup-timing";
import { cn } from "@/lib/utils";

import { DatabaseViewSkeleton } from "./database/DatabaseViewSkeleton";
import {
  DOCUMENT_EDITOR_COLUMN_CONTAINER_CLASS_NAME,
  DOCUMENT_EDITOR_DATABASE_TITLE_SIZE_CLASS_NAME,
  DOCUMENT_EDITOR_PAGE_TITLE_SIZE_CLASS_NAME,
  DOCUMENT_EDITOR_TITLE_CLASS_NAME,
  documentEditorBodyClassName,
  documentEditorDatabaseRegionClassName,
  documentEditorTitleRegionClassName,
  type DocumentEditorIconRow,
  type DocumentEditorShape,
} from "./document-editor-layout";
import { WidgetLoadDiagnostic } from "./WidgetLoadDiagnostic";

// Before the app loads, the startup script marks <html> with the icon row and
// shape the page last drew; "startup" draws from those marks, since storage is
// out of reach while the server renders.
const STARTUP_ICON_ROW_CLASS_NAME =
  "h-7 w-0 [html[data-content-page-icon-row=icon]_&]:size-14 [html[data-content-page-icon-row=none]_&]:hidden";
const STARTUP_PAGE_COLUMN_CLASS_NAME =
  "[html[data-content-page-shape=database]_&]:hidden [html[data-content-page-shape=database-constrained]_&]:hidden";
const STARTUP_DATABASE_COLUMN_CLASS_NAME =
  "hidden [html[data-content-page-shape=database]_&]:block [html[data-content-page-shape=database-constrained]_&]:block";

// The server draws this skeleton as one document for every visitor, so it
// cannot know it sits in an MCP App widget, where the host owns the page
// chrome. The startup script marks <html> before first paint; a hook would
// only answer after hydration, once the chrome had already painted.
export const HIDDEN_IN_WIDGET_CLASS_NAME =
  "[html[data-agent-native-mcp-widget]_&]:hidden";

// The editor opens the review margin from DOCUMENT_EDITOR_INLINE_REVIEW_MIN_WIDTH
// of page width, measured on the box this one stands in for.
const REVIEW_MARGIN_CLASS_NAME = "@min-[1088px]:pr-80";
const STARTUP_REVIEW_MARGIN_CLASS_NAME =
  "[html[data-content-page-shape=review]_&]:@min-[1088px]:pr-80";

function PageColumn({
  title,
  iconRow,
  review,
  className,
}: {
  title?: string | null;
  iconRow: DocumentEditorIconRow | "startup";
  review: boolean | "startup";
  className?: string;
}) {
  return (
    <div
      className={cn(
        review === "startup"
          ? STARTUP_REVIEW_MARGIN_CLASS_NAME
          : review && REVIEW_MARGIN_CLASS_NAME,
        className,
      )}
    >
      <div className={documentEditorTitleRegionClassName(false)}>
        <div className="mb-1">
          {iconRow === "startup" ? (
            <Skeleton className={STARTUP_ICON_ROW_CLASS_NAME} />
          ) : iconRow === "icon" ? (
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
          <SkeletonTitle title={title} />
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
  );
}

// A collection always draws its 56px icon, and its view below the title.
function DatabaseColumn({
  title,
  constraints,
  className,
}: {
  title?: string | null;
  constraints: boolean | "startup";
  className?: string;
}) {
  return (
    <div className={className}>
      <div className={documentEditorTitleRegionClassName(true)}>
        <div className="mb-1">
          <Skeleton className="size-14 rounded-md" />
        </div>
        <div
          {...startupAnchor("title")}
          className={cn(
            DOCUMENT_EDITOR_TITLE_CLASS_NAME,
            DOCUMENT_EDITOR_DATABASE_TITLE_SIZE_CLASS_NAME,
            "relative",
          )}
        >
          <SkeletonTitle title={title} />
        </div>
      </div>
      {title === undefined ? null : (
        <div className={documentEditorDatabaseRegionClassName()}>
          <DatabaseViewSkeleton constraints={constraints} />
        </div>
      )}
    </div>
  );
}

function SkeletonTitle({ title }: { title?: string | null }) {
  return (
    title || (
      <>
        &nbsp;
        <Skeleton className="absolute inset-y-[20%] start-0 w-2/3" />
      </>
    )
  );
}

// Every box here is the page editor's own box, so the title and what follows
// it start where the editor will draw them. While `title` is undefined the
// title is still unknown, and what follows waits for it: a title that wraps
// would move it.
export function DocumentEditorSkeleton({
  title,
  iconRow = "add",
  shape = "page",
  stalledLoad,
}: {
  title?: string | null;
  iconRow?: DocumentEditorIconRow | "startup";
  shape?: DocumentEditorShape | "startup";
  stalledLoad?: { stage: string; action: string };
}) {
  const sidebarTrigger = useSidebarTrigger();
  const skeleton = (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div
        className={cn(
          "flex h-12 shrink-0 items-center gap-3 border-b border-border px-4",
          HIDDEN_IN_WIDGET_CLASS_NAME,
        )}
      >
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
      <div
        className={cn(
          "relative @container min-h-0 flex-1 overflow-hidden",
          DOCUMENT_EDITOR_COLUMN_CONTAINER_CLASS_NAME,
        )}
      >
        {shape === "startup" ? (
          <>
            <PageColumn
              title={title}
              iconRow={iconRow}
              review="startup"
              className={STARTUP_PAGE_COLUMN_CLASS_NAME}
            />
            <DatabaseColumn
              title={title}
              constraints="startup"
              className={STARTUP_DATABASE_COLUMN_CLASS_NAME}
            />
          </>
        ) : shape === "database" || shape === "database-constrained" ? (
          <DatabaseColumn
            title={title}
            constraints={shape === "database-constrained"}
          />
        ) : (
          <PageColumn
            title={title}
            iconRow={iconRow}
            review={shape === "review"}
          />
        )}
      </div>
    </div>
  );
  return stalledLoad ? (
    <WidgetLoadDiagnostic
      active
      stage={stalledLoad.stage}
      action={stalledLoad.action}
      fallback={skeleton}
    />
  ) : (
    skeleton
  );
}
