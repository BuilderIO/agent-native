import { useLoaderData } from "react-router";
import DocsLayout from "../components/DocsLayout";
import DocContent from "../components/DocContent";
import { getDoc, type DocEntry } from "../components/docs-content";
import { withDocsSocialImage } from "../seo";

const doc = getDoc("getting-started")!;

export function loader(): DocEntry {
  return doc;
}

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
