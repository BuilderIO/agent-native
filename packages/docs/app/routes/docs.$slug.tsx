import { useParams, redirect, type LoaderFunctionArgs } from "react-router";
import DocsLayout from "../components/DocsLayout";
import MarkdownRenderer from "../components/MarkdownRenderer";
import { getDoc } from "../components/docs-content";

/** Legacy slug → current slug. Keep in sync with any renames in content/. */
const SLUG_REDIRECTS: Record<string, string> = {
  resources: "workspace",
};

export async function loader({ params }: LoaderFunctionArgs) {
  const slug = params.slug!;
  const target = SLUG_REDIRECTS[slug];
  if (target) {
    throw redirect(`/docs/${target}`, 301);
  }
  return null;
}

export const meta = ({ params }: { params: { slug: string } }) => {
  const doc = getDoc(params.slug);
  if (!doc) return [{ title: "Not Found — Agent-Native" }];
  return [
    { title: `${doc.title} — Agent-Native` },
    { name: "description", content: doc.description },
  ];
};

export default function DocPage() {
  const { slug } = useParams<{ slug: string }>();
  const doc = getDoc(slug!);

  if (!doc) {
    throw new Response("Not Found", { status: 404 });
  }

  const toc = doc.headings.map((h) => ({
    id: h.id,
    label: h.label,
    indent: h.level === 3,
  }));

  return (
    <DocsLayout toc={toc}>
      <MarkdownRenderer markdown={doc.body} />
    </DocsLayout>
  );
}
