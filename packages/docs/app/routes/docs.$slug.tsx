import { redirect, useLoaderData, type LoaderFunctionArgs } from "react-router";

import DocContent from "../components/DocContent";
import { getDoc, type DocEntry } from "../components/docs-content";
import {
  DEFAULT_DOCS_LOCALE,
  docsPathForSlug,
  isDocsLocale,
} from "../components/docs-locale";
import DocsLayout from "../components/DocsLayout";
import { withDefaultSocialImage, withDocsSocialImage } from "../seo";

/** Legacy slug → current slug. Keep in sync with any renames in content/. */
const SLUG_REDIRECTS: Record<string, string> = {
  "core-philosophy": "key-concepts",
  "database-adapters": "deployment",
  resources: "workspace",
  secrets: "security",
  // Plans docs consolidated into the single template-plan page.
  "visual-plans": "template-plan",
};

export async function loader({ params }: LoaderFunctionArgs) {
  const slug = params.slug!;
  if (isDocsLocale(slug)) {
    throw redirect(docsPathForSlug("getting-started", slug), 302);
  }

  const target = SLUG_REDIRECTS[slug];
  if (target) {
    throw redirect(docsPathForSlug(target, DEFAULT_DOCS_LOCALE), 301);
  }
  const doc = getDoc(slug);
  if (!doc) {
    throw new Response("Not Found", { status: 404 });
  }
  return doc;
}

export const meta = ({
  data,
  loaderData,
  params,
}: {
  data?: DocEntry;
  loaderData?: DocEntry;
  params: { slug: string };
}) => {
  const doc = data ?? loaderData ?? getDoc(params.slug);
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
    <DocsLayout toc={toc}>
      <DocContent markdown={doc.body} />
    </DocsLayout>
  );
}
