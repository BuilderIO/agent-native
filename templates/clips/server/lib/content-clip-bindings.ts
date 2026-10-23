import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import type { ContentDocGrant } from "./content-doc-grant.js";

export type ContentClipBinding =
  typeof schema.recordingContentBindings.$inferSelect;

export async function findContentBinding(input: {
  recordingId: string;
  contentApp: string;
  documentId: string;
}): Promise<ContentClipBinding | null> {
  const [binding] = await getDb()
    .select()
    .from(schema.recordingContentBindings)
    .where(
      and(
        eq(schema.recordingContentBindings.recordingId, input.recordingId),
        eq(schema.recordingContentBindings.contentApp, input.contentApp),
        eq(schema.recordingContentBindings.documentId, input.documentId),
      ),
    )
    .limit(1);
  return binding ?? null;
}

export async function readContentBinding(
  id: string,
): Promise<ContentClipBinding | null> {
  const [binding] = await getDb()
    .select()
    .from(schema.recordingContentBindings)
    .where(eq(schema.recordingContentBindings.id, id))
    .limit(1);
  return binding ?? null;
}

export function contentDocGrantFor(
  binding: ContentClipBinding,
  viewerEmail: string | null,
): ContentDocGrant {
  return {
    bindingId: binding.id,
    recordingId: binding.recordingId,
    origin: binding.origin,
    state: binding.state,
    viewerEmail,
  };
}
