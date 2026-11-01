import { prepareUiActionCapability } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useEffect } from "react";
import { useParams, useSearchParams } from "react-router";

import { DocumentEditor } from "@/components/editor/DocumentEditor";
import { messagesByLocale } from "@/i18n-data";

export function meta() {
  const title = messagesByLocale["en-US"].root.metaTitle;
  const description = messagesByLocale["en-US"].root.metaDescription;

  return [
    { title },
    { name: "description", content: description },
    { property: "og:description", content: description },
    { name: "twitter:description", content: description },
  ];
}

export default function DocumentPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const databaseId = searchParams.get("databaseId");
  const databaseDocumentId = searchParams.get("databaseDocumentId");
  const viewId = searchParams.get("viewId");
  // An open page sends action writes as its editor mounts, so the UI write
  // capability is minted while the page loads instead of holding them.
  useEffect(() => prepareUiActionCapability(), []);

  return id ? (
    <DocumentEditor
      documentId={id}
      foreground
      databaseId={databaseId}
      databaseDocumentId={databaseDocumentId}
      viewId={viewId}
    />
  ) : (
    <div className="flex-1 flex items-center justify-center text-muted-foreground">
      {t("empty.documentNotFound")}
    </div>
  );
}
