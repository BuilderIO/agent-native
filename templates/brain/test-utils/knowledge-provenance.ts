import {
  buildKnowledgeProvenance,
  type KnowledgeProvenanceMaterial,
} from "../server/lib/knowledge-provenance.js";

type FixtureRow = Record<string, unknown>;

export async function bindFixtureProvenance(
  row: FixtureRow,
  captures: ReadonlyArray<FixtureRow>,
) {
  const content = new Map<string, string>();
  for (const capture of captures)
    if (typeof capture.id === "string" && typeof capture.content === "string")
      content.set(capture.id, capture.content);
  row.provenanceJson = await buildKnowledgeProvenance(
    row as unknown as KnowledgeProvenanceMaterial,
    content,
  );
}

type FixtureInsert = {
  title: string;
  body: string;
  summary?: string | null | undefined;
  topic?: string | null | undefined;
  tagsJson?: string | undefined;
  entitiesJson?: string | undefined;
  evidenceJson?: string | undefined;
  confidence?: number | undefined;
  kind?: KnowledgeProvenanceMaterial["kind"] | undefined;
  sourceId?: string | null | undefined;
  captureId?: string | null | undefined;
  audienceId?: string | null | undefined;
  provenanceJson?: string | null | undefined;
};

export async function withFixtureProvenance<T extends FixtureInsert>(
  row: T,
  contentById: ReadonlyMap<string, string>,
): Promise<T> {
  const evidenceJson = row.evidenceJson ?? "[]";
  const cited = JSON.parse(evidenceJson) as Array<{ captureId: string }>;
  if (!cited.length) return row;
  const content = new Map(contentById);
  for (const item of cited)
    if (!content.has(item.captureId)) content.set(item.captureId, "");
  return {
    ...row,
    provenanceJson: await buildKnowledgeProvenance(
      {
        title: row.title,
        body: row.body,
        summary: row.summary ?? "",
        topic: row.topic ?? null,
        tagsJson: row.tagsJson ?? "[]",
        entitiesJson: row.entitiesJson ?? "[]",
        evidenceJson,
        confidence: row.confidence ?? 80,
        kind: row.kind ?? "fact",
        sourceId: row.sourceId ?? null,
        captureId: row.captureId ?? null,
        audienceId: row.audienceId ?? null,
      },
      content,
    ),
  };
}
