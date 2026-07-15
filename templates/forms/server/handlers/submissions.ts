import {
  getSession,
  readBody,
  runWithRequestContext,
  verifyCaptcha,
} from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, desc, isNull, sql } from "drizzle-orm";
import {
  defineEventHandler,
  getRouterParam,
  getQuery,
  getRequestHeader,
  setResponseStatus,
  getRequestIP,
  type H3Event,
} from "h3";
import { nanoid } from "nanoid";

import {
  cleanSubmitterEmail,
  publicSubmitterEmail,
} from "../../shared/submitter-email.js";
import type {
  FormField,
  FormIntegration,
  FormResponse,
  FormSettings,
} from "../../shared/types.js";
import { getDb, schema } from "../db/index.js";
import { fireIntegrations } from "../lib/integrations.js";
import { sendNewResponseEmail } from "../lib/response-email.js";
import {
  isEmptySubmissionValue,
  validateSubmissionField,
} from "../lib/submission-validation.js";

const MAX_PAYLOAD_BYTES = 100 * 1024; // 100KB
const MIN_FILL_TIME_MS = 500; // reject submits faster than this
const MAX_META_TEXT_LENGTH = 500;
const MAX_CHAT_SESSION_IDS = 5;

function cleanMetaText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_META_TEXT_LENGTH);
}

// Allowlist the client-surface hint so only known values are stored. Anything
// else (including spoofed direct POSTs) is dropped to NULL.
const KNOWN_CLIENT_SURFACES = new Set(["web", "electron", "tauri"]);
function cleanClientSurface(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return KNOWN_CLIENT_SURFACES.has(normalized) ? normalized : null;
}

function cleanChatSessionIds(value: unknown): string[] {
  const ids: string[] = [];
  const visit = (item: unknown) => {
    if (ids.length >= MAX_CHAT_SESSION_IDS) return;
    if (Array.isArray(item)) {
      for (const nested of item) visit(nested);
      return;
    }
    const cleaned = cleanMetaText(item);
    if (!cleaned || ids.includes(cleaned)) return;
    ids.push(cleaned);
  };
  visit(value);
  return ids;
}

export const submitForm = defineEventHandler(async (event: H3Event) => {
  const db = getDb();
  const id = getRouterParam(event, "id") as string;

  // guard:allow-unscoped — public submission endpoint intentionally accepts anonymous responses for published forms by id; it returns no owner data and rejects non-published forms.
  // Public submission endpoint: published forms are intentionally readable
  // without an authenticated viewer, but only by exact id and published status.
  // guard:allow-unscoped — anonymous respondents must be able to submit published forms; unpublished/private forms still return 404
  const form = await db
    .select()
    .from(schema.forms)
    .where(
      and(
        eq(schema.forms.id, id),
        eq(schema.forms.status, "published"),
        isNull(schema.forms.deletedAt),
      ),
    )

    .then((rows) => rows[0]);
  if (!form) {
    setResponseStatus(event, 404);
    return { error: "Form not found or not accepting responses" };
  }

  const settings: FormSettings = form.settings ? JSON.parse(form.settings) : {};

  // Origin allowlist (per-form). Empty/unset = allow any (back-compat).
  // Skip for same-origin requests (no Origin header set by browser on
  // same-origin POSTs from some setups).
  const allowedOrigins = settings.allowedOrigins ?? [];
  if (allowedOrigins.length > 0) {
    const origin = getRequestHeader(event, "origin");
    if (!origin || !allowedOrigins.includes(origin)) {
      setResponseStatus(event, 403);
      return { error: "Origin not allowed" };
    }
  }

  const body = await readBody(event).catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    setResponseStatus(event, 400);
    return { error: "Invalid submission payload" };
  }

  // Check overall payload size
  const bodyStr = JSON.stringify(body);
  if (Buffer.byteLength(bodyStr, "utf8") > MAX_PAYLOAD_BYTES) {
    setResponseStatus(event, 413);
    return { error: "Payload too large" };
  }

  // Honeypot: silently accept-and-drop if filled. Bots that fire-and-forget
  // get a 200 and never know they were caught.
  if (typeof body._hp === "string" && body._hp.length > 0) {
    return { success: true, id: "" };
  }

  // Min time-to-submit: client-controlled timestamp from when the form was
  // shown. Trivially spoofable, but blocks naive scripted submitters.
  // Negative elapsed means _t is in the future — treat as a bypass attempt.
  if (typeof body._t === "number" && body._t > 0) {
    const elapsed = Date.now() - body._t;
    if (elapsed < MIN_FILL_TIME_MS) {
      setResponseStatus(event, 429);
      return { error: "Submitted too quickly" };
    }
  }

  // Verify captcha — but only when the public site key is configured. The
  // client (SSR renderer and React page) only renders the Turnstile widget and
  // produces a token when VITE_TURNSTILE_SITE_KEY is set, so enforcing the
  // secret without the site key would reject every submission with no widget
  // ever shown. Keep the requirement symmetric: skip verification when the
  // client could not have rendered a widget.
  if (process.env.VITE_TURNSTILE_SITE_KEY) {
    const captchaResult = await verifyCaptcha(body.captchaToken ?? "");
    if (!captchaResult.success) {
      setResponseStatus(event, 403);
      return { error: "Captcha verification failed" };
    }
  }

  // Parse form fields and build whitelist of valid field IDs
  const fields: FormField[] = JSON.parse(form.fields);
  const fieldMap = new Map(fields.map((f) => [f.id, f]));
  const rawData =
    body.data && typeof body.data === "object" && !Array.isArray(body.data)
      ? (body.data as Record<string, unknown>)
      : {};

  // Whitelist: only accept keys matching form field IDs
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawData)) {
    const field = fieldMap.get(key);
    if (!field) continue; // Strip unknown fields
    data[key] = value;
  }

  // Validate required fields and field-specific constraints. Recompute
  // conditional visibility on the server so direct POSTs cannot submit hidden
  // field values or bypass client-side validation.
  function isFieldVisible(field: FormField): boolean {
    if (!field.conditional) return true;
    const { fieldId, operator, value: condValue } = field.conditional;
    const fieldVal = String(data[fieldId] ?? "");
    switch (operator) {
      case "equals":
        return fieldVal === condValue;
      case "not_equals":
        return fieldVal !== condValue;
      case "contains":
        return fieldVal.includes(condValue);
      default:
        return true;
    }
  }

  for (const field of fields) {
    if (!isFieldVisible(field)) {
      delete data[field.id];
      continue;
    }

    const val = data[field.id];
    if (field.required && isEmptySubmissionValue(val)) {
      setResponseStatus(event, 400);
      return { error: `${field.label} is required` };
    }

    const validationError = validateSubmissionField(field, val);
    if (validationError) {
      setResponseStatus(event, 400);
      return { error: validationError };
    }
  }

  const now = new Date().toISOString();
  const responseId = nanoid();
  const anonymous = settings.anonymous === true;
  const ip = anonymous ? null : (getRequestIP(event) ?? null);

  // Optional metadata sent by trusted clients (e.g. the framework's
  // FeedbackButton, which forwards the logged-in user's email so we can see
  // who sent feedback in Slack). Never required. Prefer the Forms-host session
  // when present; cross-app feedback submissions fall back to the client hint,
  // which is useful context but not verified identity.
  const meta =
    !anonymous && typeof body._meta === "object" && body._meta !== null
      ? (body._meta as {
          submitterEmail?: unknown;
          chatSessionId?: unknown;
          chatSessionIds?: unknown;
          activeRunId?: unknown;
          pageUrl?: unknown;
          clientSurface?: unknown;
        })
      : null;
  const session = anonymous ? null : await getSession(event).catch(() => null);
  const submitterEmail =
    cleanSubmitterEmail(session?.email) ??
    cleanSubmitterEmail(meta?.submitterEmail);
  const chatSessionIds = cleanChatSessionIds([
    meta?.chatSessionId,
    meta?.chatSessionIds,
  ]);
  const activeRunId = cleanMetaText(meta?.activeRunId);
  const pageUrl = cleanMetaText(meta?.pageUrl);
  const clientSurface = cleanClientSurface(meta?.clientSurface);

  await db.insert(schema.responses).values({
    id: responseId,
    formId: id,
    data: JSON.stringify(data),
    submittedAt: now,
    ip,
    submitterEmail,
    pageUrl,
    clientSurface,
  });

  // Write submission notification to application state (SQL-backed)
  try {
    const { appStatePut } =
      await import("@agent-native/core/application-state");
    await appStatePut(form.ownerEmail, "new-submission", {
      formId: id,
      responseId,
      timestamp: now,
    });
  } catch {
    // Non-critical — don't fail the submission
  }

  if (settings.emailOnNewResponses === true && form.ownerEmail) {
    try {
      await sendNewResponseEmail({
        to: form.ownerEmail,
        formTitle: form.title,
        fields,
        data,
        submittedAt: now,
      });
    } catch (error) {
      // Email is best-effort — a provider outage must not reject a public
      // submission that was already persisted successfully.
      console.warn("[forms] new response email failed:", error);
    }
  }

  // Fire integrations best-effort and never fail the submission. Keep this
  // awaited: serverless hosts can freeze fire-and-forget work as soon as the
  // HTTP response returns, which silently drops Slack/webhook delivery.
  // pageUrl and clientSurface are persisted on the response (above) so owners
  // can see which screen and which app feedback came from; chat session ids and
  // run ids remain integration-only debug breadcrumbs we don't retain in SQL.
  try {
    const integrations: FormIntegration[] = settings.integrations ?? [];
    if (integrations.length > 0) {
      await fireIntegrations(integrations, {
        formId: id,
        formTitle: form.title,
        responseId,
        fields,
        data,
        submittedAt: now,
        submitterEmail,
        chatSessionIds,
        activeRunId,
        pageUrl,
        clientSurface,
      });
    }
  } catch {
    // Non-critical
  }

  return { success: true, id: responseId };
});

export const listResponses = defineEventHandler(async (event: H3Event) => {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Sign in to view responses" };
  }

  const id = getRouterParam(event, "id") as string;
  const query = getQuery(event);
  const requestedLimit = parseInt((query.limit as string) || "100", 10);
  const limit = Math.min(Math.max(requestedLimit || 100, 1), 500);

  return runWithRequestContext(
    { userEmail: session.email, orgId: session.orgId ?? undefined },
    async () => {
      let access;
      try {
        access = await assertAccess("form", id, "editor");
      } catch {
        setResponseStatus(event, 404);
        return { error: "Form not found" };
      }

      const db = getDb();
      const rows = await db
        .select()
        .from(schema.responses)
        .where(eq(schema.responses.formId, id))
        .orderBy(desc(schema.responses.submittedAt))
        .limit(limit);
      const total = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.responses)
        .where(eq(schema.responses.formId, id))

        .then((rows) => rows[0]);

      return {
        responses: rows.map((r) => ({
          id: r.id,
          formId: r.formId,
          data: JSON.parse(r.data),
          submittedAt: r.submittedAt,
          submitterEmail: publicSubmitterEmail(r.submitterEmail),
          pageUrl: r.pageUrl ?? null,
          clientSurface: r.clientSurface ?? null,
        })) as FormResponse[],
        total: total?.count ?? 0,
        fields: JSON.parse(access.resource.fields),
      };
    },
  );
});
