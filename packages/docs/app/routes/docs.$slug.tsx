import { useParams, redirect, type LoaderFunctionArgs } from "react-router";
import DocsLayout from "../components/DocsLayout";
import MarkdownRenderer from "../components/MarkdownRenderer";
import { getDoc } from "../components/docs-content";
import { withDefaultSocialImage } from "../seo";

/** Legacy slug → current slug. Keep in sync with any renames in content/. */
const SLUG_REDIRECTS: Record<string, string> = {
  resources: "workspace",
  secrets: "security",
  // Plans docs consolidated into the single template-plan page.
  "visual-plans": "template-plan",
};

export async function loader({ params }: LoaderFunctionArgs) {
  const slug = params.slug!;
  const target = SLUG_REDIRECTS[slug];
  if (target) {
    throw redirect(`/docs/${target}`, 301);
  }
  if (!getDoc(slug)) {
    throw new Response("Not Found", { status: 404 });
  }
  return null;
}

export const meta = ({ params }: { params: { slug: string } }) => {
  const doc = getDoc(params.slug);
  if (!doc)
    return withDefaultSocialImage([{ title: "Not Found — Agent-Native" }]);
  return withDefaultSocialImage([
    { title: `${doc.title} — Agent-Native` },
    { name: "description", content: doc.description },
    { property: "og:title", content: `${doc.title} — Agent-Native` },
    { property: "og:description", content: doc.description },
    { property: "og:type", content: "article" },
  ]);
};

export default function DocPage() {
  const { slug } = useParams<{ slug: string }>();
  const doc = getDoc(slug!);

  // Loader already throws 404 for unknown slugs; this is just a type-narrowing
  // guard for the TypeScript type — should never be reached at runtime.
  if (!doc) return null;

  const toc = doc.headings.map((h) => ({
    id: h.id,
    label: h.label,
    level: h.level,
  }));

  return (
    <DocsLayout toc={toc}>
      <MarkdownRenderer markdown={doc.body} />
    </DocsLayout>
  );
}
