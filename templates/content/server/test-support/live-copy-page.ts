import { saveYDocState } from "@agent-native/core/collab";
import { getDbExec } from "@agent-native/core/db";
import { registerFeatureFlags } from "@agent-native/core/feature-flags";
import { putSetting } from "@agent-native/core/settings";
import { initProseMirrorDoc, updateYFragment } from "@tiptap/y-tiptap";
import { eq } from "drizzle-orm";
import * as Y from "yjs";

import { createContentEditorStructuralSchema } from "../../shared/content-editor-structural-schema.js";
import {
  CONTENT_FEATURE_FLAGS,
  LIVE_BODY_SHADOW_FLAG,
  LIVE_BODY_WRITER_FLAG,
} from "../../shared/feature-flags.js";
import { nfmToDoc } from "../../shared/nfm.js";
import { getDb, schema } from "../db/index.js";

function rulesFor(emails: string[]) {
  return {
    version: 1,
    mode: "rules",
    emails,
    orgIds: [],
    percentage: 0,
    updatedAt: null,
    updatedBy: null,
  };
}

/** The live copy's stored version for page `id`, or undefined without one. */
export async function liveCopyVersionOf(
  id: string,
): Promise<number | undefined> {
  const { rows } = await getDbExec().execute({
    sql: "SELECT version FROM _collab_docs WHERE doc_id = ?",
    args: [id],
  });
  const row = rows[0] as { version: unknown } | undefined;
  return row === undefined ? undefined : Number(row.version);
}

/** A Yjs document holding `content` as the editor stores it. */
function seededLiveCopy(content: string): Y.Doc {
  const schema = createContentEditorStructuralSchema();
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment("default");
  const { meta } = initProseMirrorDoc(fragment, schema);
  updateYFragment(doc, fragment, schema.nodeFromJSON(nfmToDoc(content)), meta);
  return doc;
}

/**
 * Makes page `id` take body writes through its live copy, as the write-path
 * gate reads it: switched, both markers current, and both flags on for its
 * owner. Without `seeded` the live copy holds an empty Yjs document, so it
 * suits writers refused before they reach it, not writes through it; with
 * it, the copy holds the page's body, so a write through it can commit.
 */
export async function putPageOnLiveCopy(
  id: string,
  { seeded = false }: { seeded?: boolean } = {},
): Promise<void> {
  registerFeatureFlags(CONTENT_FEATURE_FLAGS);
  const [page] = await getDb()
    .select({
      ownerEmail: schema.documents.ownerEmail,
      bodyRevision: schema.documents.bodyRevision,
      content: schema.documents.content,
    })
    .from(schema.documents)
    .where(eq(schema.documents.id, id));
  if (!page) throw new Error(`No page ${id} to put on its live copy.`);
  const doc = seeded ? seededLiveCopy(page.content) : new Y.Doc();
  await saveYDocState(id, Y.encodeStateAsUpdate(doc), page.content);
  doc.destroy();
  const version = await liveCopyVersionOf(id);
  await getDb()
    .update(schema.documents)
    .set({
      liveBodySwitchedAt: new Date().toISOString(),
      collabBodyRevision: page.bodyRevision,
      liveCopyVersion: version,
    })
    .where(eq(schema.documents.id, id));
  for (const flag of [LIVE_BODY_SHADOW_FLAG, LIVE_BODY_WRITER_FLAG]) {
    await putSetting(`feature-flag:${flag.key}`, rulesFor([page.ownerEmail]));
  }
}

/** Turns both live-copy flags off for everyone, as main runs (SF-11). */
export async function turnLiveCopyFlagsOff(): Promise<void> {
  for (const flag of [LIVE_BODY_SHADOW_FLAG, LIVE_BODY_WRITER_FLAG]) {
    await putSetting(`feature-flag:${flag.key}`, rulesFor([]));
  }
}
