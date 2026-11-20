import { isDeepStrictEqual } from "node:util";

import { desc, eq, inArray } from "drizzle-orm";

import { schema } from "../server/db/index.js";
import type { FormSettings } from "../shared/form-contract.js";
import type { Block } from "../shared/form-model/index.js";
import { firstRow, nowIso } from "./_access.js";
import { newFormId, type Db, type Tx } from "./_form-store.js";

export const MAX_VERSIONS = 50;

/**
 * The settings a version captures and a restore replaces exactly. Anything else
 * (password, notifications, domains, close time, submissions limit) is
 * operational and a restore leaves it alone.
 */
export const VERSIONED_SETTING_KEYS = [
  "closedMessage",
  "redirectOnCompletion",
  "progressBar",
  "autoJump",
  "language",
  "saveAnswersForLater",
  "partialSubmissions",
  "preventDuplicates",
  "theme",
  "customCss",
] as const;

export function versionedSettings(settings: FormSettings): FormSettings {
  const picked: FormSettings = {};
  for (const key of VERSIONED_SETTING_KEYS)
    if (settings[key] !== undefined)
      Object.assign(picked, { [key]: settings[key] });
  return picked;
}

/** Current settings with the versioned keys replaced by the snapshot's. */
export function restoredSettings(
  current: FormSettings,
  snapshot: FormSettings,
): FormSettings {
  const next = { ...current };
  for (const key of VERSIONED_SETTING_KEYS) delete next[key];
  return { ...next, ...versionedSettings(snapshot) };
}
export const AUTOSAVE_WINDOW_MS = 5 * 60_000;

type VersionTarget = { id: string; orgId: string | null };

/**
 * Publishing always snapshots (unless nothing changed since the newest one).
 * Autosave snapshots at most once per window and edits inside the window
 * merge into that snapshot, so a publish snapshot is never overwritten.
 */
export async function recordVersion(
  db: Db | Tx,
  form: VersionTarget,
  input: { blocks: Block[]; settings: FormSettings },
  kind: "publish" | "autosave",
  author: string,
): Promise<void> {
  const { formVersions } = schema;
  const latest = firstRow(
    await db
      .select()
      .from(formVersions)
      .where(eq(formVersions.formId, form.id))
      .orderBy(desc(formVersions.createdAt), desc(formVersions.id))
      .limit(1),
  );
  const now = nowIso();
  const snapshot = {
    blocks: input.blocks,
    settings: versionedSettings(input.settings),
  };
  const values = { ...snapshot, author, updatedAt: now };
  if (
    kind === "autosave" &&
    latest &&
    Date.parse(latest.createdAt) > Date.now() - AUTOSAVE_WINDOW_MS
  ) {
    if (latest.kind === "autosave")
      await db
        .update(formVersions)
        .set(values)
        .where(eq(formVersions.id, latest.id));
    return;
  }
  if (
    kind === "publish" &&
    latest &&
    isDeepStrictEqual(latest.blocks, snapshot.blocks) &&
    isDeepStrictEqual(latest.settings, snapshot.settings)
  ) {
    await db
      .update(formVersions)
      .set({ kind, author, updatedAt: now })
      .where(eq(formVersions.id, latest.id));
    return;
  }
  await db.insert(formVersions).values({
    id: newFormId(),
    orgId: form.orgId,
    formId: form.id,
    kind,
    ...values,
    createdAt: now,
  });
  const stale = await db
    .select({ id: formVersions.id })
    .from(formVersions)
    .where(eq(formVersions.formId, form.id))
    .orderBy(desc(formVersions.createdAt), desc(formVersions.id))
    .offset(MAX_VERSIONS);
  if (stale.length)
    await db.delete(formVersions).where(
      inArray(
        formVersions.id,
        stale.map((row) => row.id),
      ),
    );
}
