import { withSsrHtmlContentType } from "@agent-native/core/shared";
import { redirect, useLoaderData, type LoaderFunctionArgs } from "react-router";

import DocContent from "../components/DocContent";
import DocDraftBanner from "../components/DocDraftBanner";
import {
  loadDocRespectingDraftVisibility,
  type DocEntry,
} from "../components/docs-content";
import {
  DEFAULT_DOCS_LOCALE,
  docsPathForSlug,
  isDocsLocale,
} from "../components/docs-locale";
import { docsMarkdownPathForDoc } from "../components/docs-seo";
import { DOCS_SLUG_REDIRECTS } from "../components/docs-slug-redirects";
import DocsLayout from "../components/DocsLayout";
import { withDefaultSocialImage, withDocsSocialImage } from "../seo";

export async function loader({ params }: LoaderFunctionArgs) {
  const slug = params.slug!;
  if (isDocsLocale(slug)) {
    throw withSsrHtmlContentType(
      redirect(docsPathForSlug("getting-started", slug), 302),
    );
  }

  const target = DOCS_SLUG_REDIRECTS[slug];
  if (target) {
    throw withSsrHtmlContentType(
      redirect(docsPathForSlug(target, DEFAULT_DOCS_LOCALE), 301),
    );
  }
  const doc = await loadDocRespectingDraftVisibility(slug);
  if (!doc) {
    throw new Response("Not Found", { status: 404 });
  }
  return doc;
}

export const meta = ({
  data,
  loaderData,
}: {
  data?: DocEntry;
  loaderData?: DocEntry;
}) => {
  const doc = data ?? loaderData;
  if (!doc)
    return withDefaultSocialImage([{ title: "Not Found — Agent-Native" }]);
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

export default function DocPage() {
  const doc = useLoaderData<typeof loader>();

  const toc = doc.headings.map((h) => ({
    id: h.id,
    label: h.label,
    level: h.level,
  }));

  return (
    <DocsLayout
      toc={toc}
      markdownUrl={
        docsMarkdownPathForDoc(doc.slug, DEFAULT_DOCS_LOCALE) ?? undefined
      }
    >
      {doc.draft && <DocDraftBanner />}
      <DocContent markdown={doc.body} />
    </DocsLayout>
  );
}
