import DocsLayout from "../components/DocsLayout";
import DocContent from "../components/DocContent";
import { getDoc } from "../components/docs-content";
import { withDocsSocialImage } from "../seo";

const doc = getDoc("getting-started")!;

export const meta = () =>
  withDocsSocialImage(
    [
      { title: `${doc.title} — Agent-Native` },
      { name: "description", content: doc.description },
      { property: "og:title", content: `${doc.title} — Agent-Native` },
      { property: "og:description", content: doc.description },
      { property: "og:type", content: "article" },
    ],
    doc.title,
  );

export default function DocsIndex() {
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
