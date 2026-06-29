import { useT } from "@agent-native/core/client";
import { useParams } from "react-router";

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

  return id ? (
    <DocumentEditor documentId={id} />
  ) : (
    <div className="flex-1 flex items-center justify-center text-muted-foreground">
      {t("empty.documentNotFound")}
    </div>
  );
}
