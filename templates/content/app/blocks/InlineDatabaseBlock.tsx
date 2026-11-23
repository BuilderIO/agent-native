import type {
  BlockReadProps,
  BlockRenderContext,
  BlockSpec,
} from "@agent-native/core/blocks/server";
import { inlineDatabaseBlockConfig } from "@shared/inline-database-block";
import type { InlineDatabaseData } from "@shared/inline-database-block";
import { IconDatabase } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useState } from "react";

import {
  contentDatabaseConstrainedQueryFilter,
  contentDatabaseQueryFilter,
} from "@/hooks/use-content-database";
import { useDocument } from "@/hooks/use-documents";

const MISSING_COLLECTION_RECHECK_DELAYS_MS = [1000, 2000, 4000];

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
  const contentCtx = ctx as ContentBlockRenderContext;
  const canEdit = contentCtx.canEdit ?? true;
  const documentQuery = useDocument(data.databaseDocumentId || null);
  const document = documentQuery.data;
  const { isError, refetch } = documentQuery;
  const [readFailed, setReadFailed] = useState(false);
  const queryClient = useQueryClient();
  const databaseDocumentId = data.databaseDocumentId;

  useEffect(() => {
    if (isError) {
      setReadFailed(true);
      return;
    }
    if (!document || !readFailed) return;
    void queryClient.invalidateQueries(
      contentDatabaseQueryFilter(databaseDocumentId),
    );
    void queryClient.invalidateQueries(
      contentDatabaseConstrainedQueryFilter(databaseDocumentId),
    );
    setReadFailed(false);
  }, [databaseDocumentId, document, isError, queryClient, readFailed]);

  const recheck = readFailed && canEdit;
  useEffect(() => {
    if (!recheck) return;
    let attempt = 0;
    let timer: number | undefined;
    const schedule = () => {
      timer = window.setTimeout(() => {
        void refetch({ cancelRefetch: false });
        attempt += 1;
        if (attempt < MISSING_COLLECTION_RECHECK_DELAYS_MS.length) schedule();
      }, MISSING_COLLECTION_RECHECK_DELAYS_MS[attempt]);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [recheck, refetch]);

  if (!data.databaseId || !data.databaseDocumentId) {
    return <InlineDatabaseUnavailable />;
  }

  if (
    isError ||
    (readFailed && !document) ||
    (document &&
      (!document.database || document.database.id !== data.databaseId))
  ) {
    return <InlineDatabaseUnavailable />;
  }

  const hostDocumentId = contentCtx.documentId ?? data.databaseDocumentId;

  return (
    <Suspense fallback={null}>
      <InlineDatabaseView
        databaseId={data.databaseId}
        databaseDocumentId={data.databaseDocumentId}
        hostDocumentId={hostDocumentId}
        renderMode="inline"
        canEdit={canEdit}
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
      Collection unavailable
    </div>
  );
}

export const inlineDatabaseBlock: BlockSpec<InlineDatabaseData> = {
  ...inlineDatabaseBlockConfig,
  Read: InlineDatabaseRead,
  editSurface: "none",
  icon: IconDatabase,
};
