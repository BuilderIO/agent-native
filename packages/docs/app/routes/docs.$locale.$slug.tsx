import {
  redirect,
  useLoaderData,
  useParams,
  type LoaderFunctionArgs,
} from "react-router";

import DocContent from "../components/DocContent";
import { getDoc, loadDoc, type DocEntry } from "../components/docs-content";
import {
  DEFAULT_DOCS_LOCALE,
  docsPathForSlug,
  isDocsLocale,
  type DocsLocale,
} from "../components/docs-locale";
import DocsLayout from "../components/DocsLayout";
import { withDefaultSocialImage, withDocsSocialImage } from "../seo";

/** Legacy slug -> current slug. Keep in sync with docs.$slug.tsx. */
const SLUG_REDIRECTS: Record<string, string> = {
  "core-philosophy": "key-concepts",
  "database-adapters": "deployment",
  resources: "workspace",
  secrets: "security",
  "visual-plans": "template-plan",
};

function requireLocale(value: unknown): DocsLocale {
  if (isDocsLocale(value)) return value;
  throw new Response("Not Found", { status: 404 });
}

export async function loader({ params, request, url }: LoaderFunctionArgs) {
  const locale = requireLocale(params.locale);
  const slug = params.slug!;
  const requestUrl = url ?? new URL(request.url);

  if (locale === DEFAULT_DOCS_LOCALE) {
    throw redirect(docsPathForSlug(slug, DEFAULT_DOCS_LOCALE), 301);
  }

  const target = SLUG_REDIRECTS[slug];
  if (target) {
    throw redirect(docsPathForSlug(target, locale), 301);
  }

  if (requestUrl.pathname.startsWith("/docs/")) {
    throw redirect(docsPathForSlug(slug, locale), 301);
  }

  const doc = await loadDoc(slug, locale);
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
  params: { locale?: string; slug?: string };
}) => {
  const locale = isDocsLocale(params.locale)
    ? params.locale
    : DEFAULT_DOCS_LOCALE;
  const doc =
    data ??
    loaderData ??
    (params.slug ? getDoc(params.slug, locale) : undefined);
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

export default function LocalizedDocPage() {
  const doc = useLoaderData<typeof loader>();
  const { locale: localeParam } = useParams<{
    locale: string;
  }>();
  requireLocale(localeParam);

  if (!doc) return null;

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
