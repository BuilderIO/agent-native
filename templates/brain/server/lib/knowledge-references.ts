import { searchKnowledgeRows } from "./brain.js";

export async function lookupKnowledgeReferences(query: string) {
  const rows = await searchKnowledgeRows({
    query,
    includeDrafts: true,
    limit: 10,
  });
  return rows.map((row) => ({
    id: row.id,
    label: row.title,
    description: row.summary || row.topic || undefined,
    icon: "document" as const,
    refType: "brain-knowledge",
    refId: row.id,
  }));
}
