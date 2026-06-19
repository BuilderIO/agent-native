import { useParams } from "react-router";
import { DocumentEditor } from "@/components/editor/DocumentEditor";

export function meta() {
  const description =
    "Open Source MDX editor for local docs, knowledge bases, and content systems, with custom blocks and agent-assisted editing.";

  return [
    {
      title:
        "Agent-Native Content - Open Source, agent-friendly Obsidian alternative",
    },
    { name: "description", content: description },
    { property: "og:description", content: description },
    { name: "twitter:description", content: description },
  ];
}

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>();

  return id ? (
    <DocumentEditor documentId={id} />
  ) : (
    <div className="flex-1 flex items-center justify-center text-muted-foreground">
      Document not found
    </div>
  );
}
