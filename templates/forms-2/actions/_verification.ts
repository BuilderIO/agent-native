import { createHash, randomInt, timingSafeEqual } from "node:crypto";

import { isEmailConfigured } from "@agent-native/core/server";
import { and, eq, gt, sql } from "drizzle-orm";

import { schema } from "../server/db/index.js";
import type { SubmitResult } from "../shared/form-contract.js";
import { deriveQuestions, type Answers } from "../shared/form-model/index.js";
import { firstRow, nowIso } from "./_access.js";
import type { Db } from "./_form-store.js";
import { sendVerificationCode } from "./_notify.js";

const CODE_TTL_MS = 3_600_000;
const RESEND_COOLDOWN_MS = 60_000;
const MAX_SENDS = 5;
const MAX_ATTEMPTS = 5;
const MAX_SENDS_PER_ADDRESS_HOUR = 20;

type Refusal = Extract<SubmitResult, { ok: false }>;
type Form = typeof schema.forms.$inferSelect;

const refuse = (reason: Refusal["reason"], verifyEmail: string): Refusal => ({
  ok: false,
  reason,
  errors: [],
  verifyEmail,
});

const hashCode = (sessionId: string, questionId: string, code: string) =>
  createHash("sha256").update(`${sessionId}:${questionId}:${code}`).digest();

/**
 * Null when every email question that requires verification holds a
 * verified address, otherwise the refusal to return. A missing code sends
 * one (at most one per cooldown); a code is checked and then marks the
 * question verified.
 */
export async function checkEmailVerification(
  db: Db,
  args: {
    form: Form;
    sessionId: string;
    answers: Answers;
    code: string | undefined;
    ipHash: string | null;
  },
): Promise<Refusal | null> {
  const { form, sessionId, answers, code, ipHash } = args;
  const { emailVerifications: table } = schema;
  const pending = deriveQuestions(form.publishedBlocks).flatMap((question) => {
    const value = answers[question.id];
    const wanted =
      question.type === "INPUT_EMAIL" &&
      (question.settings.payload as { requireVerification?: unknown })
        .requireVerification === true;
    return wanted && typeof value === "string" && value.trim()
      ? [{ questionId: question.id, email: value.trim().toLowerCase() }]
      : [];
  });

  if (pending.length && !(await isEmailConfigured()))
    // No mail provider: the code would only be printed to the server log, and the
    // respondent would wait for an email that was never sent. Say so instead.
    return refuse("verify_unavailable", pending[0]!.email);

  for (const { questionId, email } of pending) {
    const slot = and(
      eq(table.formId, form.id),
      eq(table.sessionId, sessionId),
      eq(table.questionId, questionId),
    );
    const row = firstRow(await db.select().from(table).where(slot).limit(1));
    if (row?.email === email && row.verifiedAt) continue;
    const now = Date.now();

    if (code !== undefined && row?.email === email) {
      if (row.attempts >= MAX_ATTEMPTS) return refuse("code_limit", email);
      if (Date.parse(row.expiresAt) < now) return refuse("code_expired", email);
      const expected = Buffer.from(row.codeHash, "hex");
      const actual = hashCode(sessionId, questionId, code.trim());
      if (!timingSafeEqual(expected, actual)) {
        await db
          .update(table)
          .set({ attempts: sql`${table.attempts} + 1` })
          .where(slot);
        return refuse("wrong_code", email);
      }
      await db.update(table).set({ verifiedAt: nowIso() }).where(slot);
      continue;
    }

    const cooling =
      row?.email === email &&
      Date.parse(row.lastSentAt) + RESEND_COOLDOWN_MS > now;
    if (cooling) return refuse("verify", email);
    if (row && row.sendCount >= MAX_SENDS) return refuse("code_limit", email);
    if (ipHash) {
      const since = new Date(now - CODE_TTL_MS).toISOString();
      const recent = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(table)
        .where(
          and(
            eq(table.formId, form.id),
            eq(table.ipHash, ipHash),
            gt(table.createdAt, since),
          ),
        );
      if ((recent[0]?.n ?? 0) >= MAX_SENDS_PER_ADDRESS_HOUR)
        return refuse("code_limit", email);
    }

    const fresh = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await sendVerificationCode(form, email, fresh);
    const values = {
      email,
      codeHash: hashCode(sessionId, questionId, fresh).toString("hex"),
      expiresAt: new Date(now + CODE_TTL_MS).toISOString(),
      attempts: 0,
      verifiedAt: null,
      lastSentAt: nowIso(),
    };
    if (row)
      await db
        .update(table)
        .set({ ...values, sendCount: row.sendCount + 1 })
        .where(slot);
    else
      await db.insert(table).values({
        id: crypto.randomUUID(),
        formId: form.id,
        sessionId,
        questionId,
        ipHash,
        sendCount: 1,
        createdAt: nowIso(),
        ...values,
      });
    return refuse("verify", email);
  }
  return null;
}
