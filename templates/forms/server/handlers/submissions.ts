import {
  defineEventHandler,
  getRouterParam,
  getQuery,
  getRequestHeader,
  setResponseStatus,
  getRequestIP,
  type H3Event,
} from "h3";
import { eq, desc, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { readBody, verifyCaptcha } from "@agent-native/core/server";
import { getDb, schema } from "../db/index.js";
import type {
  FormField,
  FormIntegration,
  FormResponse,
  FormSettings,
} from "../../shared/types.js";
import { fireIntegrations } from "../lib/integrations.js";

// ---------------------------------------------------------------------------
// Field value size limits by type
// ---------------------------------------------------------------------------

const MAX_FIELD_LENGTH: Record<string, number> = {
  text: 1000,
  email: 1000,
  number: 1000,
  date: 1000,
  select: 1000,
  checkbox: 1000,
  radio: 1000,
  rating: 1000,
  scale: 1000,
  textarea: 10000,
  multiselect: 10000,
};

const MAX_PAYLOAD_BYTES = 100 * 1024; // 100KB
const MIN_FILL_TIME_MS = 500; // reject submits faster than this

export const submitForm = defineEventHandler(async (event: H3Event) => {
  const db = getDb();
  const id = getRouterParam(event, "id") as string;

  // Look up the form
  const form = await db
    .select()
    .from(schema.forms)
    .where(eq(schema.forms.id, id))

    .then((rows) => rows[0]);
  if (!form || form.status !== "published") {
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

  const body = await readBody(event);

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

  // Verify captcha
  const captchaResult = await verifyCaptcha(body.captchaToken ?? "");
  if (!captchaResult.success) {
    setResponseStatus(event, 403);
    return { error: "Captcha verification failed" };
  }

  // Parse form fields and build whitelist of valid field IDs
  const fields: FormField[] = JSON.parse(form.fields);
  const fieldMap = new Map(fields.map((f) => [f.id, f]));
  const rawData = body.data || {};

  // Whitelist: only accept keys matching form field IDs
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawData)) {
    const field = fieldMap.get(key);
    if (!field) continue; // Strip unknown fields

    // Validate string length per field type
    const maxLen = MAX_FIELD_LENGTH[field.type] ?? 1000;
    if (typeof value === "string" && value.length > maxLen) {
      setResponseStatus(event, 400);
      return {
        error: `${field.label} exceeds maximum length of ${maxLen} characters`,
      };
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && item.length > maxLen) {
          setResponseStatus(event, 400);
          return {
            error: `${field.label} contains a value exceeding maximum length`,
          };
        }
      }
    }

    data[key] = value;
  }

  // Validate required fields (respecting conditional visibility)
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
    if (field.required && isFieldVisible(field)) {
      const val = data[field.id];
      const isEmpty =
        val === undefined ||
        val === null ||
        val === "" ||
        val === false ||
        (Array.isArray(val) && val.length === 0);
      if (isEmpty) {
        setResponseStatus(event, 400);
        return { error: `${field.label} is required` };
      }
    }
  }

  const now = new Date().toISOString();
  const responseId = nanoid();
  const ip = getRequestIP(event) ?? null;

  await db.insert(schema.responses).values({
    id: responseId,
    formId: id,
    data: JSON.stringify(data),
    submittedAt: now,
    ip,
  });

  // Write submission notification to application state (SQL-backed)
  try {
    const { appStatePut } =
      await import("@agent-native/core/application-state");
    await appStatePut("local", "new-submission", {
      formId: id,
      responseId,
      timestamp: now,
    });
  } catch {
    // Non-critical — don't fail the submission
  }

  // Fire integrations (non-blocking, never fails the submission)
  try {
    const integrations: FormIntegration[] = settings.integrations ?? [];
    if (integrations.length > 0) {
      // Fire-and-forget — don't await to keep response fast
      fireIntegrations(integrations, {
        formId: id,
        formTitle: form.title,
        responseId,
        fields,
        data,
        submittedAt: now,
      }).catch(() => {});
    }
  } catch {
    // Non-critical
  }

  return { success: true, id: responseId };
});

export const listResponses = defineEventHandler(async (event: H3Event) => {
  const db = getDb();
  const id = getRouterParam(event, "id") as string;
  const query = getQuery(event);
  const limit = parseInt((query.limit as string) || "100", 10);

  // Verify form exists
  const form = await db
    .select()
    .from(schema.forms)
    .where(eq(schema.forms.id, id))

    .then((rows) => rows[0]);
  if (!form) {
    setResponseStatus(event, 404);
    return { error: "Form not found" };
  }

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
    })) as FormResponse[],
    total: total?.count ?? 0,
    fields: JSON.parse(form.fields),
  };
});
