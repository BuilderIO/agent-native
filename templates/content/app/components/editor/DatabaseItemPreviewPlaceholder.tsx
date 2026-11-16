import type { ContentDatabaseItem } from "@shared/api";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { ContentIcon } from "../icons/ContentIcon";
import type { DatabaseRowView } from "./database/row-view-layout";
import {
  DOCUMENT_EDITOR_COLUMN_CONTAINER_CLASS_NAME,
  DOCUMENT_EDITOR_DATABASE_TITLE_SIZE_CLASS_NAME,
  DOCUMENT_EDITOR_TITLE_CLASS_NAME,
  documentEditorBodyClassName,
  documentEditorTitleRegionClassName,
} from "./document-editor-layout";
import { DocumentProperties } from "./DocumentProperties";
import { DocumentToolbar } from "./DocumentToolbar";

export type DatabaseItemPreviewRow = {
  item: ContentDatabaseItem;
  /** Whether this viewer edits the collection, which adds its schema rows. */
  collectionEditable: boolean;
};

function ignoreUtilityPanelChange() {}

// While a row's page is read, its panel draws what the row already knows, in
// the boxes the page will use: the toolbar, the title and the Properties stay
// put through the switch, and only the page's text is still to come. Nothing
// here can be used until the page itself takes over.
export function DatabaseItemPreviewPlaceholder({
  row: { item, collectionEditable },
  documentId,
  databaseId,
  databaseDocumentId,
  rowView,
}: {
  row: DatabaseItemPreviewRow;
  documentId: string;
  databaseId: string | null;
  databaseDocumentId: string | null;
  rowView?: DatabaseRowView | null | undefined;
}) {
  const { document } = item;
  return (
    <div
      // The border stands in for the edge of the page's closed comment rail.
      className="flex min-h-0 min-w-0 flex-1 flex-col border-e border-transparent bg-background"
      data-database-item-preview-placeholder=""
      aria-busy="true"
      inert
    >
      <DocumentToolbar
        compact
        documentId={documentId}
        documentTitle={document.title}
        canEdit={document.canEdit === true}
        readOnly={document.mcpDirectoryWidgetReadOnly === true}
        showCommentsControl={document.canComment !== false}
        openCommentCount={item.comments?.open ?? 0}
        utilityPanel={null}
        onUtilityPanelChange={ignoreUtilityPanelChange}
      />
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <div className={DOCUMENT_EDITOR_COLUMN_CONTAINER_CLASS_NAME}>
          <div className={documentEditorTitleRegionClassName(false, "preview")}>
            <div className="mb-1">
              {document.icon ? (
                <div className="-ml-1 flex size-14 items-center justify-center p-1">
                  <ContentIcon value={document.icon} size={48} />
                </div>
              ) : document.canEdit === true ? (
                <div className="h-7" />
              ) : null}
            </div>
            <div
              className={cn(
                DOCUMENT_EDITOR_TITLE_CLASS_NAME,
                DOCUMENT_EDITOR_DATABASE_TITLE_SIZE_CLASS_NAME,
                "whitespace-pre-wrap",
              )}
            >
              {document.title || " "}
            </div>
          </div>
          <div className="mx-auto w-full max-w-3xl px-4 pb-3 sm:px-6">
            <DocumentProperties
              documentId={documentId}
              databaseId={databaseId}
              databaseDocumentId={databaseDocumentId}
              rowView={rowView}
              canEdit={document.canEdit === true}
              schemaRowsExpected={
                collectionEditable && document.canEdit === true
              }
              popoversPortalled={false}
            />
          </div>
          <div className={documentEditorBodyClassName("preview")}>
            <div className="space-y-3 pt-1.5">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
