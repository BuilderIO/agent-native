import {
  randomBytes,
  scrypt,
  timingSafeEqual,
  createHash,
  createHmac,
  type BinaryLike,
} from "node:crypto";

import { and, eq, isNull, sql } from "drizzle-orm";

import { clientIp } from "../server/client-ip.js";
import { schema } from "../server/db/index.js";
import {
  type FormSettings,
  type PublicFormResult,
  type RetentionUnit,
} from "../shared/form-contract.js";
import type { Answers } from "../shared/form-model/index.js";
import { firstRow, orgScope } from "./_access.js";
import { isClosedNow, type Db } from "./_form-store.js";

const scryptAsync = (password: string, salt: BinaryLike) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 32, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return `scrypt:${salt.toString("hex")}:${key.toString("hex")}`;
}

async function passwordMatches(
  password: string,
  stored: string,
): Promise<boolean> {
  const [scheme, salt, key] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "hex");
  const actual = await scryptAsync(password, Buffer.from(salt, "hex"));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

type Found = {
  form: typeof schema.forms.$inferSelect;
  completed: number;
};

const ATTEMPT_WINDOW_MS = 10 * 60_000;
const CLIENT_MAX_FAILURES = 5;
const FORM_MAX_FAILURES = 50;

type Gate =
  | { status: "open" }
  | { status: "locked" }
  | { status: "throttled"; retryAfterSeconds: number };

/** Failures per window, counted in the database so every server instance shares them. */
async function failuresIn(db: Db, key: string, now: number) {
  const { passwordAttempts } = schema;
  const row = firstRow(
    await db
      .select()
      .from(passwordAttempts)
      .where(eq(passwordAttempts.key, key)),
  );
  if (!row || Date.parse(row.windowStart) + ATTEMPT_WINDOW_MS <= now)
    return { count: 0, retryAfterSeconds: 0 };
  return {
    count: row.count,
    retryAfterSeconds: Math.ceil(
      (Date.parse(row.windowStart) + ATTEMPT_WINDOW_MS - now) / 1000,
    ),
  };
}

async function recordFailure(db: Db, key: string, now: number) {
  const { passwordAttempts } = schema;
  const stamp = new Date(now).toISOString();
  const expired = new Date(now - ATTEMPT_WINDOW_MS).toISOString();
  await db
    .insert(passwordAttempts)
    .values({ key, count: 1, windowStart: stamp })
    .onConflictDoUpdate({
      target: passwordAttempts.key,
      set: {
        count: sql`case when ${passwordAttempts.windowStart} < ${expired} then 1 else ${passwordAttempts.count} + 1 end`,
        windowStart: sql`case when ${passwordAttempts.windowStart} < ${expired} then ${stamp} else ${passwordAttempts.windowStart} end`,
      },
    });
}

/**
 * An unprotected form is open. A protected one needs the right password; a
 * missing password is locked without counting as a guess, wrong guesses are
 * limited per client and per form, and no stored hash means nobody gets in.
 */
export async function passwordGate(
  db: Db,
  form: Pick<Found["form"], "id" | "passwordHash"> & { settings: FormSettings },
  password: string | undefined,
  sessionId: string | undefined,
  now = Date.now(),
): Promise<Gate> {
  if (form.settings.passwordProtected !== true) return { status: "open" };
  if (password === undefined) return { status: "locked" };
  const client = ipHashFor(form.id) ?? `session:${sessionId ?? "none"}`;
  const limits = [
    { key: `password:${form.id}:${client}`, max: CLIENT_MAX_FAILURES },
    { key: `password:${form.id}`, max: FORM_MAX_FAILURES },
  ];
  let wait = 0;
  for (const { key, max } of limits) {
    const failures = await failuresIn(db, key, now);
    if (failures.count >= max)
      wait = Math.max(wait, failures.retryAfterSeconds);
  }
  if (wait > 0) return { status: "throttled", retryAfterSeconds: wait };
  if (form.passwordHash && (await passwordMatches(password, form.passwordHash)))
    return { status: "open" };
  for (const { key } of limits) await recordFailure(db, key, now);
  return { status: "locked" };
}

/** What a respondent may read: blocks only once the form is open and any password is right. */
export async function publicFormResult(
  db: Db,
  { form, completed }: Found,
  password?: string,
  sessionId?: string,
): Promise<PublicFormResult> {
  if (isClosedNow(form, completed))
    return { state: "closed", message: form.settings.closedMessage ?? null };
  const gate = await passwordGate(db, form, password, sessionId);
  if (gate.status !== "open") {
    const { theme, customCss, language } = form.settings;
    return {
      state: "locked",
      ...(gate.status === "throttled"
        ? { retryAfterSeconds: gate.retryAfterSeconds }
        : {}),
      name: form.name,
      settings: {
        ...(theme ? { theme } : {}),
        ...(customCss ? { customCss } : {}),
        ...(language ? { language } : {}),
      },
    };
  }
  const publicSettings = { ...form.settings };
  delete publicSettings.selfEmail;
  delete publicSettings.respondentEmail;
  return {
    state: "open",
    form: {
      id: form.id,
      name: form.name,
      blocks: form.publishedBlocks,
      settings: publicSettings,
    },
  };
}

// Without the deployment secret a fixed literal key would make every hash reversible; a per-process key keeps
// rate limits working locally, at the cost of hashes that change on restart.
const processIpKey = randomBytes(32).toString("hex");

/** Keyed hash, so a leaked table cannot be reversed by trying every address. */
export const ipHashFor = (formId: string): string | null => {
  const ip = clientIp();
  return ip
    ? createHmac("sha256", process.env.BETTER_AUTH_SECRET || processIpKey)
        .update(`${formId}:${ip}`)
        .digest("hex")
    : null;
};

/**
 * What makes a completed submission a duplicate, or null when the form does
 * not dedupe or the submission has no value to compare. Stored on the row and
 * guarded by a partial unique index, so the database settles races.
 */
export function dedupeKeyFor(
  form: { settings: FormSettings },
  respondentId: string,
  ipHash: string | null,
  answers: Answers,
): string | null {
  if (form.settings.preventDuplicates !== true) return null;
  const key = form.settings.uniqueSubmissionKey ?? "respondent";
  if (key === "ip") return ipHash ? `ip:${ipHash}` : null;
  if (key.startsWith("field:")) {
    const value = answers[key.slice("field:".length)];
    return value == null
      ? null
      : `${key}:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
  }
  return `respondent:${respondentId}`;
}

export const DEDUPE_INDEX = "forms_submissions_dedupe";

/** True for the unique violation raised by the dedupe index, through any driver wrapper. */
export function isDuplicateViolation(error: unknown): boolean {
  for (let e = error; e instanceof Error; e = (e as { cause?: unknown }).cause)
    if (e.message.includes(DEDUPE_INDEX)) return true;
  return false;
}

/** False when a newer completed submission already holds this one's dedupe key. */
export async function restoreSubmissionRow(
  db: Db,
  id: string,
  orgId: string | null,
): Promise<boolean> {
  const { submissions } = schema;
  try {
    await db
      .update(submissions)
      .set({ deletedAt: null })
      .where(and(eq(submissions.id, id), orgScope(submissions, orgId)));
    return true;
  } catch (error) {
    if (isDuplicateViolation(error)) return false;
    throw error;
  }
}

export const RESTORE_DUPLICATE_MESSAGE =
  "A newer submission from this respondent exists, so this one can't be restored.";

export function retentionCutoff(
  now: Date,
  value: number,
  unit: RetentionUnit,
): Date {
  const cutoff = new Date(now);
  if (unit === "month") cutoff.setUTCMonth(cutoff.getUTCMonth() - value);
  else if (unit === "year")
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - value);
  else {
    const ms = {
      minute: 60_000,
      hour: 3_600_000,
      day: 86_400_000,
      week: 604_800_000,
    }[unit];
    cutoff.setTime(cutoff.getTime() - value * ms);
  }
  return cutoff;
}

/** Moves submissions older than each form's retention period to the Trash. */
export async function trashExpiredSubmissions(
  db: Db,
  now = new Date(),
): Promise<number> {
  const { forms, submissions } = schema;
  const rows = await db
    .select({ id: forms.id, orgId: forms.orgId, settings: forms.settings })
    .from(forms)
    .where(sql`${forms.settings}->'dataRetention'->>'enabled' = 'true'`);
  let trashed = 0;
  for (const { id, orgId, settings } of rows) {
    const retention = settings.dataRetention;
    if (!retention?.enabled) continue;
    const cutoff = retentionCutoff(now, retention.value, retention.unit);
    const moved = await db
      .update(submissions)
      .set({ deletedAt: now.toISOString() })
      .where(
        and(
          orgScope(submissions, orgId),
          eq(submissions.formId, id),
          isNull(submissions.deletedAt),
          sql`${submissions.submittedAt} < ${cutoff.toISOString()}`,
        ),
      )
      .returning({ id: submissions.id });
    trashed += moved.length;
  }
  return trashed;
}
