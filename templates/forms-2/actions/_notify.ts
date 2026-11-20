import {
  AppConfigurationError,
  getAppConfig,
} from "@agent-native/core/app-config";
import {
  escapeEmailHtml,
  renderEmail,
  sendEmail,
} from "@agent-native/core/server";
import { and, eq, gt, sql } from "drizzle-orm";

import { schema } from "../server/db/index.js";
import {
  answerToText,
  deriveQuestions,
  resolveMentions,
  type Answers,
} from "../shared/form-model/index.js";
import { firstRow, frameworkOrgId, nowIso } from "./_access.js";
import type { Db } from "./_form-store.js";

type FormRow = typeof schema.forms.$inferSelect;

export const RESPONDENT_MAIL_PER_IP_HOUR = 10;
export const RESPONDENT_MAIL_PER_FORM_DAY = 200;

const BRAND = "Forms";

// A localhost fallback mailed dead links to form owners from every deployment that forgot APP_URL.
const baseUrl = (): string | null =>
  getAppConfig().app.url?.replace(/\/+$/, "") ?? null;

function send(
  form: FormRow,
  to: string,
  subject: string,
  rendered: ReturnType<typeof renderEmail>,
  extra: { templateId: string; idempotencyKey?: string; authCritical?: true },
) {
  const orgId = frameworkOrgId(form.orgId);
  return sendEmail({
    ...extra,
    to,
    subject,
    html: rendered.html,
    text: rendered.text,
    ...(orgId ? { orgId } : {}),
  });
}

/** A respondent can type any address, so unbounded confirmations would let a form mail-bomb a stranger. */
async function respondentMailAllowed(
  db: Db,
  formId: string,
  ipHash: string | null,
  now = Date.now(),
): Promise<boolean> {
  const { respondentMailLog: log } = schema;
  const sent = async (where: ReturnType<typeof and>) =>
    firstRow(
      await db
        .select({ n: sql<number>`count(*)::int` })
        .from(log)
        .where(where),
    )?.n ?? 0;
  const since = (ms: number) => new Date(now - ms).toISOString();
  if (
    ipHash !== null &&
    (await sent(
      and(
        eq(log.formId, formId),
        eq(log.ipHash, ipHash),
        gt(log.at, since(3_600_000)),
      ),
    )) >= RESPONDENT_MAIL_PER_IP_HOUR
  )
    return false;
  return (
    (await sent(and(eq(log.formId, formId), gt(log.at, since(86_400_000))))) <
    RESPONDENT_MAIL_PER_FORM_DAY
  );
}

/**
 * Account-access mail: it must reach the respondent even where notification mail skips test identities.
 * The email log redacts a number only within 40 characters after the words "verification code" in the body, never in the subject.
 */
export async function sendVerificationCode(
  form: FormRow,
  to: string,
  code: string,
) {
  const rendered = renderEmail({
    brandName: BRAND,
    preheader: `Your 6-digit code for ${form.name}`,
    heading: "Confirm your email address",
    paragraphs: [
      `Enter this code to finish submitting ${escapeEmailHtml(form.name)}.`,
      `Your verification code: <strong>${code}</strong>`,
      "The code expires in one hour. If you did not ask for it, you can ignore this email.",
    ],
  });
  await send(form, to, "Your verification code", rendered, {
    templateId: "forms-verification-code",
    authCritical: true,
  });
}

/**
 * Mail for one completed submission. Failures are logged and swallowed: the
 * submission is already stored and the respondent must still see the thank-you.
 */
export async function sendSubmissionEmails(args: {
  db: Db;
  form: FormRow;
  submissionId: string;
  respondentId: string;
  ipHash: string | null;
  answers: Answers;
}) {
  const { db, form, submissionId, respondentId, ipHash, answers } = args;
  const { selfEmail, respondentEmail } = form.settings;
  const questions = deriveQuestions(form.publishedBlocks);
  const textOf = (questionId: string) => {
    const question = questions.find((q) => q.id === questionId);
    const value = answers[questionId];
    return question && value != null ? answerToText(question, value) : "";
  };
  const jobs: Promise<unknown>[] = [];

  const base = baseUrl();
  // Rejected into jobs so it is logged with the other mail failures; the respondent's submission is already stored.
  if (selfEmail?.enabled === true && !base)
    jobs.push(
      Promise.reject(
        new AppConfigurationError(
          "Set APP_URL to this deployment's public URL so form emails link back to it.",
        ),
      ),
    );
  if (selfEmail?.enabled === true && base) {
    const rows = questions.flatMap((question) => {
      const text = textOf(question.id);
      return text
        ? [
            `<strong>${escapeEmailHtml(question.title)}</strong><br />${escapeEmailHtml(text).replace(/\r?\n/g, "<br />")}`,
          ]
        : [];
    });
    const rendered = renderEmail({
      brandName: BRAND,
      preheader: `New response to ${form.name}`,
      heading: `New response to ${form.name}`,
      paragraphs: rows.length
        ? rows
        : ["The respondent left every answer blank."],
      cta: {
        label: "Open the response",
        url: `${base}/forms/${form.id}/submissions?submission=${submissionId}`,
      },
    });
    for (const to of selfEmail.to)
      jobs.push(
        send(form, to, `New response: ${form.name}`, rendered, {
          templateId: "forms-notification",
          idempotencyKey: `forms-self-${submissionId}-${to}`,
        }),
      );
  }

  if (respondentEmail?.enabled === true) {
    const to = textOf(respondentEmail.toQuestionId).trim();
    const mailable = to.includes("@");
    const allowed =
      mailable && (await respondentMailAllowed(db, form.id, ipHash));
    if (mailable && !allowed)
      console.warn(
        `[forms] respondent notification skipped for form ${form.id}: send cap reached`,
      );
    if (allowed) {
      await db.insert(schema.respondentMailLog).values({
        id: crypto.randomUUID(),
        formId: form.id,
        ipHash,
        at: nowIso(),
      });
      const fill = (text: string) =>
        resolveMentions(text, (ref) =>
          ref.kind === "answer"
            ? textOf(ref.questionId)
            : {
                "submission-id": submissionId,
                "respondent-id": respondentId,
                "form-name": form.name,
              }[ref.field],
        );
      const subject =
        fill(respondentEmail.subject)
          .replace(/[\r\n]+/g, " ")
          .trim() || form.name;
      const body = fill(respondentEmail.message)
        .split(/\r?\n\r?\n/)
        .filter((part) => part.trim())
        .map((part) => escapeEmailHtml(part).replace(/\r?\n/g, "<br />"));
      const rendered = renderEmail({
        brandName: BRAND,
        preheader: subject,
        heading: subject,
        paragraphs: body.length ? body : [escapeEmailHtml(form.name)],
      });
      jobs.push(
        send(form, to, subject, rendered, {
          templateId: "forms-notification",
          idempotencyKey: `forms-respondent-${submissionId}`,
        }),
      );
    }
  }

  for (const result of await Promise.allSettled(jobs))
    if (result.status === "rejected")
      console.error("[forms] notification email failed", result.reason);
}
