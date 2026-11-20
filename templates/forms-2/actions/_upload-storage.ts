import {
  getActiveFileUploadProviderForRequest,
  uploadFile,
  type FileUploadInput,
  type FileUploadResult,
} from "@agent-native/core/file-upload";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { and, eq, gt, sql } from "drizzle-orm";

import { schema } from "../server/db/index.js";
import {
  deriveQuestions,
  type DerivedQuestion,
} from "../shared/form-model/index.js";
import { firstRow, frameworkOrgId, orgScope } from "./_access.js";
import type { Db } from "./_form-store.js";

export const SESSION_UPLOADS_PER_MINUTE = 10;
export const IP_UPLOADS_PER_MINUTE = 20;
export const FORM_UPLOADS_PER_MINUTE = 60;
/** One session is one submission; this bounds the files a single submission can carry. */
export const MAX_FILES_PER_SUBMISSION = 25;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

type Found = { form: typeof schema.forms.$inferSelect };

export type FormOwner = { email: string; orgId: string | null };

export function uploadQuestions(form: Found["form"]): DerivedQuestion[] {
  return deriveQuestions(form.publishedBlocks).filter(
    (question) =>
      question.type === "FILE_UPLOAD" || question.type === "SIGNATURE",
  );
}

export async function formOwner(
  db: Db,
  form: Found["form"],
): Promise<FormOwner | null> {
  const workspace = firstRow(
    await db
      .select({ createdBy: schema.workspaces.createdBy })
      .from(schema.workspaces)
      .where(
        and(
          eq(schema.workspaces.id, form.workspaceId),
          orgScope(schema.workspaces, form.orgId),
        ),
      )
      .limit(1),
  );
  return workspace
    ? { email: workspace.createdBy, orgId: frameworkOrgId(form.orgId) }
    : null;
}

/** Storage-only identity, the same shape the framework builds to read an owner's storage readiness. */
function asOwner<T>(owner: FormOwner, run: () => Promise<T>): Promise<T> {
  return Promise.resolve(
    runWithRequestContext(
      {
        userEmail: owner.email,
        orgScope: "personal",
        builderStorageCredentialOrgId: owner.orgId,
      },
      run,
    ),
  );
}

export async function ownerStorageConfigured(
  owner: FormOwner,
): Promise<boolean> {
  try {
    return (
      (await asOwner(owner, getActiveFileUploadProviderForRequest)) !== null
    );
  } catch {
    // coercion-ok: a storage lookup that fails means uploads aren't available right now.
    return false;
  }
}

export function uploadAsOwner(
  owner: FormOwner,
  input: FileUploadInput,
): Promise<FileUploadResult | null> {
  return asOwner(owner, () => uploadFile(input));
}

export type UploadRefusal = "slow_down" | "too_many_files";

export async function uploadRefusal(
  db: Db,
  formId: string,
  sessionId: string,
  ipHash: string | null,
  now = Date.now(),
): Promise<UploadRefusal | null> {
  const { uploadLog } = schema;
  const count = async (where: ReturnType<typeof and>) =>
    firstRow(
      await db
        .select({ n: sql<number>`count(*)::int` })
        .from(uploadLog)
        .where(where),
    )?.n ?? 0;
  const since = (ms: number) => new Date(now - ms).toISOString();

  if (
    (await count(
      and(eq(uploadLog.sessionId, sessionId), gt(uploadLog.at, since(DAY_MS))),
    )) >= MAX_FILES_PER_SUBMISSION
  )
    return "too_many_files";
  if (
    (await count(
      and(
        eq(uploadLog.sessionId, sessionId),
        gt(uploadLog.at, since(MINUTE_MS)),
      ),
    )) >= SESSION_UPLOADS_PER_MINUTE ||
    (ipHash !== null &&
      (await count(
        and(
          eq(uploadLog.formId, formId),
          eq(uploadLog.ipHash, ipHash),
          gt(uploadLog.at, since(MINUTE_MS)),
        ),
      )) >= IP_UPLOADS_PER_MINUTE) ||
    (await count(
      and(eq(uploadLog.formId, formId), gt(uploadLog.at, since(MINUTE_MS))),
    )) >= FORM_UPLOADS_PER_MINUTE
  )
    return "slow_down";
  return null;
}

export async function logUpload(
  db: Db,
  formId: string,
  sessionId: string,
  ipHash: string | null,
  now = Date.now(),
) {
  await db.insert(schema.uploadLog).values({
    id: crypto.randomUUID(),
    formId,
    sessionId,
    ipHash,
    at: new Date(now).toISOString(),
  });
}
