import { createHash } from "node:crypto";

import { fail } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { and, count, desc, eq, gte } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { firstRow } from "../server/lib/first-row.js";
import {
  contentFormReceiptAnswerSchema,
  type ContentFormChannel,
  type ContentFormReceipt,
  type ContentFormSender,
} from "../shared/content-forms.js";
import type { ContentFormIdentity } from "./_content-form-questions.js";
import { nanoid } from "./_property-utils.js";
import type { CollectionFormRecordCreated } from "./submit-content-database-form.js";

type ContentDb = ReturnType<typeof getDb>;
export type ContentFormSubmissionRow =
  typeof schema.contentFormSubmissions.$inferSelect;

const storedReceiptSchema = z.object({
  formTitle: z.string(),
  answers: z.array(contentFormReceiptAnswerSchema),
  thankYouMessage: z.string(),
  submittedProperties: z.array(
    z.object({ propertyId: z.string(), name: z.string() }),
  ),
  submittedContent: z.boolean(),
});
export type StoredContentFormReceipt = z.infer<typeof storedReceiptSchema>;

export class ContentFormSubmissionExists extends Error {
  constructor(readonly submission: ContentFormSubmissionRow) {
    super("This form already has a submission with that idempotency key.");
    this.name = "ContentFormSubmissionExists";
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

export function contentFormAnswersDigest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

export function sortedContentFormEntries(
  entries: ReadonlyArray<readonly [string, unknown]>,
): Array<readonly [string, unknown]> {
  return [...entries].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

function formSubmissionsWhere(form: ContentFormIdentity) {
  return and(
    eq(schema.contentFormSubmissions.databaseId, form.databaseId),
    eq(schema.contentFormSubmissions.viewId, form.viewId),
  );
}

export async function findContentFormSubmission(
  db: ContentDb,
  form: ContentFormIdentity,
  idempotencyKey: string,
): Promise<ContentFormSubmissionRow | undefined> {
  return firstRow(
    await db
      .select()
      .from(schema.contentFormSubmissions)
      .where(
        and(
          formSubmissionsWhere(form),
          eq(schema.contentFormSubmissions.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1),
  );
}

export async function assertNoContentFormSubmission(
  db: ContentDb,
  form: ContentFormIdentity,
  idempotencyKey: string,
): Promise<void> {
  const existing = await findContentFormSubmission(db, form, idempotencyKey);
  if (existing) throw new ContentFormSubmissionExists(existing);
}

export async function listSenderContentFormSubmissions(
  db: ContentDb,
  form: ContentFormIdentity,
  senderEmail: string,
  limit: number,
): Promise<ContentFormSubmissionRow[]> {
  return db
    .select()
    .from(schema.contentFormSubmissions)
    .where(
      and(
        formSubmissionsWhere(form),
        eq(schema.contentFormSubmissions.channel, "link"),
        eq(schema.contentFormSubmissions.senderEmail, senderEmail),
      ),
    )
    .orderBy(desc(schema.contentFormSubmissions.createdAt))
    .limit(limit);
}

export async function countRecentContentFormSubmissions(
  db: ContentDb,
  form: ContentFormIdentity,
  sinceIso: string,
): Promise<number> {
  const rows = await db
    .select({ total: count() })
    .from(schema.contentFormSubmissions)
    .where(
      and(
        formSubmissionsWhere(form),
        eq(schema.contentFormSubmissions.channel, "link"),
        gte(schema.contentFormSubmissions.createdAt, sinceIso),
      ),
    );
  return rows.reduce((total, row) => total + row.total, 0);
}

export function readStoredContentFormReceipt(
  submission: ContentFormSubmissionRow,
): StoredContentFormReceipt {
  const parsed = storedReceiptSchema.safeParse(
    JSON.parse(submission.receiptJson),
  );
  if (!parsed.success) {
    // guard:allow-bare-error — invariant: only insertContentFormSubmission writes receipts, from this schema
    throw new Error(`Form receipt ${submission.id} can't be read.`);
  }
  return parsed.data;
}

function sameContentFormSender(
  submission: ContentFormSubmissionRow,
  sender: ContentFormSender,
): boolean {
  return sender.kind === "anonymous"
    ? submission.senderKind === "anonymous"
    : submission.senderKind === "signed_in" &&
        submission.senderEmail === sender.email;
}

export function assertSameContentFormSubmission(
  submission: ContentFormSubmissionRow,
  attempt: { sender: ContentFormSender; digest: string },
): StoredContentFormReceipt {
  if (
    !sameContentFormSender(submission, attempt.sender) ||
    submission.answersDigest !== attempt.digest
  ) {
    fail(
      "This idempotencyKey was already used for different answers, so nothing new was saved. Send new answers with a new key.",
      { errorCode: "idempotency_conflict", statusCode: 409 },
    );
  }
  return readStoredContentFormReceipt(submission);
}

export async function insertContentFormSubmission(
  db: ContentDb,
  input: {
    form: ContentFormIdentity;
    created: CollectionFormRecordCreated;
    channel: ContentFormChannel;
    sender: ContentFormSender;
    idempotencyKey: string;
    digest: string;
    receipt: StoredContentFormReceipt;
  },
): Promise<ContentFormSubmissionRow> {
  const submission: ContentFormSubmissionRow = {
    id: nanoid(20),
    databaseId: input.form.databaseId,
    viewId: input.form.viewId,
    documentId: input.created.documentId,
    itemId: input.created.itemId,
    channel: input.channel,
    senderKind: input.sender.kind,
    senderEmail: input.sender.kind === "signed_in" ? input.sender.email : null,
    idempotencyKey: input.idempotencyKey,
    answersDigest: input.digest,
    receiptJson: JSON.stringify(input.receipt),
    createdAt: input.created.now,
  };
  await db.insert(schema.contentFormSubmissions).values(submission);
  return submission;
}

function receiptSender(
  submission: ContentFormSubmissionRow,
): ContentFormSender {
  if (submission.senderKind === "anonymous") return { kind: "anonymous" };
  if (submission.senderKind === "signed_in" && submission.senderEmail) {
    return { kind: "signed_in", email: submission.senderEmail };
  }
  // guard:allow-bare-error — invariant: insertContentFormSubmission stores an email with every signed-in sender
  throw new Error(`Form receipt ${submission.id} has no readable sender.`);
}

export function contentFormReceipt(
  submission: ContentFormSubmissionRow,
): ContentFormReceipt {
  const stored = readStoredContentFormReceipt(submission);
  return {
    receiptId: submission.id,
    formTitle: stored.formTitle,
    submittedAt: submission.createdAt,
    answers: stored.answers,
    record: {
      documentId: submission.documentId,
      itemId: submission.itemId,
      urlPath: `/page/${submission.documentId}`,
      deepLink: buildDeepLink({
        app: "content",
        view: "editor",
        params: { documentId: submission.documentId },
      }),
    },
    thankYouMessage: stored.thankYouMessage,
    sender: receiptSender(submission),
    idempotencyKey: submission.idempotencyKey,
  };
}

export async function deleteContentFormDraftRow(
  db: ContentDb,
  form: ContentFormIdentity,
  senderEmail: string,
): Promise<void> {
  await db
    .delete(schema.contentFormDrafts)
    .where(
      and(
        eq(schema.contentFormDrafts.databaseId, form.databaseId),
        eq(schema.contentFormDrafts.viewId, form.viewId),
        eq(schema.contentFormDrafts.senderEmail, senderEmail),
      ),
    );
}
