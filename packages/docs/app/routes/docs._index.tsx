import { useLoaderData, type LoaderFunctionArgs } from "react-router";

import DocContent from "../components/DocContent";
import { getDoc, loadDoc, type DocEntry } from "../components/docs-content";
import { DEFAULT_DOCS_LOCALE, isDocsLocale } from "../components/docs-locale";
import DocsLayout from "../components/DocsLayout";
import { withDefaultSocialImage, withDocsSocialImage } from "../seo";

const GETTING_STARTED_SLUG = "getting-started";

function routeLocale(params: LoaderFunctionArgs["params"]) {
  return isDocsLocale(params.locale) ? params.locale : DEFAULT_DOCS_LOCALE;
}

export async function loader({
  params,
}: LoaderFunctionArgs): Promise<DocEntry> {
  const doc = await loadDoc(GETTING_STARTED_SLUG, routeLocale(params));
  if (!doc) throw new Response("Not Found", { status: 404 });
  return doc;
}

export const meta = ({
  data,
  loaderData,
}: { data?: DocEntry; loaderData?: DocEntry } = {}) => {
  const doc = data ?? loaderData ?? getDoc(GETTING_STARTED_SLUG);
  if (!doc) {
    return withDefaultSocialImage([{ title: "Not Found — Agent-Native" }]);
  }
  return withDocsSocialImage(
    [
      { title: `${doc.title} — Agent-Native` },
      { name: "description", content: doc.description },
      { property: "og:title", content: `${doc.title} — Agent-Native` },
      { property: "og:description", content: doc.description },
      { property: "og:type", content: "article" },
    ],
    doc.title,
  );
};

export default function DocsIndex() {
  const currentDoc = useLoaderData<typeof loader>();

  const toc = currentDoc.headings.map((h) => ({
    id: h.id,
    label: h.label,
    level: h.level,
  }));

  return (
    <DocsLayout toc={toc}>
      <DocContent markdown={currentDoc.body} />
    </DocsLayout>
  );
}
