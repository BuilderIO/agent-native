import DocsLayout from "../components/DocsLayout";
import MarkdownRenderer from "../components/MarkdownRenderer";
import { getDoc } from "../components/docs-content";
import { withDefaultSocialImage } from "../seo";

const doc = getDoc("getting-started")!;

export const meta = () =>
  withDefaultSocialImage([
    { title: `${doc.title} — Agent-Native` },
    { name: "description", content: doc.description },
  ]);

export default function DocsIndex() {
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
