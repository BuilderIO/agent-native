import type { ActionRunContext } from "@agent-native/core/action";
import { and, eq, lt } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import { firstRow } from "../server/lib/first-row.js";
import {
  CONTENT_FORM_DRAFT_TTL_DAYS,
  contentFormAnswersSchema,
  type ContentFormAnswerEntry,
  type ContentFormDraft,
} from "../shared/content-forms.js";
import type { ContentFormIdentity } from "./_content-form-questions.js";
import { deleteContentFormDraftRow } from "./_content-form-receipts.js";
import {
  contentFormSender,
  refuseContentForm,
  resolveLinkedContentForm,
} from "./_content-forms.js";

export const CONTENT_FORM_DRAFT_TTL_MS =
  CONTENT_FORM_DRAFT_TTL_DAYS * 24 * 60 * 60 * 1000;

function draftsWhere(form: ContentFormIdentity, senderEmail: string) {
  return and(
    eq(schema.contentFormDrafts.databaseId, form.databaseId),
    eq(schema.contentFormDrafts.viewId, form.viewId),
    eq(schema.contentFormDrafts.senderEmail, senderEmail),
  );
}

async function draftOwner(link: string, ctx?: ActionRunContext) {
  const linked = await resolveLinkedContentForm(link);
  if (linked.audience === "anonymous") {
    refuseContentForm({
      code: "drafts_unavailable",
      message:
        "Answers to an anonymous form are kept only in your browser until you send them.",
    });
  }
  const { sender, refusal } = await contentFormSender(linked, ctx);
  if (refusal) refuseContentForm(refusal);
  if (sender.kind === "anonymous") {
    refuseContentForm({
      code: "sign_in_required",
      message: "Sign in to keep a draft of this form.",
    });
  }
  return { form: linked.identity, email: sender.email };
}

function draftView(
  answers: ContentFormAnswerEntry[],
  updatedAt: string,
): ContentFormDraft {
  return {
    answers,
    updatedAt,
    expiresAt: new Date(
      Date.parse(updatedAt) + CONTENT_FORM_DRAFT_TTL_MS,
    ).toISOString(),
  };
}

export async function deleteExpiredContentFormDrafts(
  now = Date.now(),
  form?: ContentFormIdentity,
): Promise<number> {
  const cutoff = new Date(now - CONTENT_FORM_DRAFT_TTL_MS).toISOString();
  const deleted = await getDb()
    .delete(schema.contentFormDrafts)
    .where(
      and(
        lt(schema.contentFormDrafts.updatedAt, cutoff),
        ...(form
          ? [
              eq(schema.contentFormDrafts.databaseId, form.databaseId),
              eq(schema.contentFormDrafts.viewId, form.viewId),
            ]
          : []),
      ),
    )
    .returning({ databaseId: schema.contentFormDrafts.databaseId });
  return deleted.length;
}

export async function saveContentFormDraft(
  input: { link: string; answers: ContentFormAnswerEntry[] },
  ctx?: ActionRunContext,
): Promise<ContentFormDraft> {
  const { form, email } = await draftOwner(input.link, ctx);
  const now = new Date().toISOString();
  await deleteExpiredContentFormDrafts(Date.parse(now), form);
  const answersJson = JSON.stringify(input.answers);
  await getDb()
    .insert(schema.contentFormDrafts)
    .values({
      ...form,
      senderEmail: email,
      answersJson,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.contentFormDrafts.databaseId,
        schema.contentFormDrafts.viewId,
        schema.contentFormDrafts.senderEmail,
      ],
      set: { answersJson, updatedAt: now },
    });
  return draftView(input.answers, now);
}

export async function getContentFormDraft(
  input: { link: string },
  ctx?: ActionRunContext,
): Promise<ContentFormDraft | null> {
  const { form, email } = await draftOwner(input.link, ctx);
  const draft = firstRow(
    await getDb()
      .select()
      .from(schema.contentFormDrafts)
      .where(draftsWhere(form, email))
      .limit(1),
  );
  if (!draft) return null;
  if (Date.parse(draft.updatedAt) + CONTENT_FORM_DRAFT_TTL_MS <= Date.now()) {
    return null;
  }
  const answers = contentFormAnswersSchema.safeParse(
    JSON.parse(draft.answersJson),
  );
  if (!answers.success) {
    // guard:allow-bare-error — invariant: saveContentFormDraft stores only schema-checked answers
    throw new Error("This form's saved draft can't be read.");
  }
  return draftView(answers.data, draft.updatedAt);
}

export async function clearContentFormDraft(
  input: { link: string },
  ctx?: ActionRunContext,
): Promise<{ cleared: true }> {
  const { form, email } = await draftOwner(input.link, ctx);
  await deleteContentFormDraftRow(getDb(), form, email);
  return { cleared: true };
}
