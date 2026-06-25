import type {
  BlockReadProps,
  BlockRenderContext,
  BlockSpec,
} from "@agent-native/core/blocks";
import { inlineDatabaseBlockConfig } from "@shared/inline-database-block";
import type { InlineDatabaseData } from "@shared/inline-database-block";
import { IconDatabase } from "@tabler/icons-react";
import { lazy, Suspense } from "react";

import { useDocument } from "@/hooks/use-documents";

const InlineDatabaseView = lazy(async () => {
  const module = await import("@/components/editor/database/DatabaseView");
  return { default: module.DatabaseView };
});

type ContentBlockRenderContext = BlockRenderContext & {
  documentId?: string | null;
  canEdit?: boolean;
};

export function InlineDatabaseRead({
  data,
  ctx,
}: BlockReadProps<InlineDatabaseData>) {
  const documentQuery = useDocument(data.databaseDocumentId || null);
  const document = documentQuery.data;

  if (!data.databaseId || !data.databaseDocumentId) {
    return <InlineDatabaseUnavailable />;
  }

  if (
    documentQuery.isError ||
    (document &&
      (!document.database || document.database.id !== data.databaseId))
  ) {
    return <InlineDatabaseUnavailable />;
  }

  const contentCtx = ctx as ContentBlockRenderContext;
  const hostDocumentId = contentCtx.documentId ?? data.databaseDocumentId;

  return (
    <Suspense fallback={null}>
      <InlineDatabaseView
        databaseId={data.databaseId}
        databaseDocumentId={data.databaseDocumentId}
        hostDocumentId={hostDocumentId}
        renderMode="inline"
        canEdit={contentCtx.canEdit ?? true}
        isActive={false}
      />
    </Suspense>
  );
}

function InlineDatabaseUnavailable() {
  return (
    <div
      data-plan-interactive
      className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-3 text-sm text-muted-foreground"
    >
      Database unavailable
    </div>
  );
}

export const inlineDatabaseBlock: BlockSpec<InlineDatabaseData> = {
  ...inlineDatabaseBlockConfig,
  Read: InlineDatabaseRead,
  editSurface: "none",
  icon: IconDatabase,
};
