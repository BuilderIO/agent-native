import DocsLayout from "../components/DocsLayout";
import MarkdownRenderer from "../components/MarkdownRenderer";
import { getDoc } from "../components/docs-content";
import { withDefaultSocialImage } from "../seo";

const doc = getDoc("getting-started")!;

export const meta = () =>
  withDefaultSocialImage([
    { title: `${doc.title} — Agent-Native` },
    { name: "description", content: doc.description },
    { property: "og:title", content: `${doc.title} — Agent-Native` },
    { property: "og:description", content: doc.description },
    { property: "og:type", content: "article" },
  ]);

export default function DocsIndex() {
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
