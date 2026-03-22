import {
  defineEventHandler,
  readBody,
  getRouterParam,
  getQuery,
  setResponseStatus,
  getRequestIP,
  type H3Event,
} from "h3";
import { eq, desc, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { verifyCaptcha } from "@agent-native/core/server";
import { db, schema } from "../db/index.js";
import type { FormField, FormResponse } from "../../shared/types.js";

export const submitForm = defineEventHandler(async (event: H3Event) => {
  const id = getRouterParam(event, "id") as string;

  // Look up the form
  const form = db
    .select()
    .from(schema.forms)
    .where(eq(schema.forms.id, id))
    .get();
  if (!form || form.status !== "published") {
    setResponseStatus(event, 404);
    return { error: "Form not found or not accepting responses" };
  }

  const body = await readBody(event);

  // Verify captcha
  const captchaResult = await verifyCaptcha(body.captchaToken ?? "");
  if (!captchaResult.success) {
    setResponseStatus(event, 403);
    return { error: "Captcha verification failed" };
  }

  // Validate required fields (respecting conditional visibility)
  const fields: FormField[] = JSON.parse(form.fields);
  const data = body.data || {};

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
      if (val === undefined || val === null || val === "") {
        setResponseStatus(event, 400);
        return { error: `${field.label} is required` };
      }
    }
  }

  const now = new Date().toISOString();
  const responseId = nanoid();
  const ip = getRequestIP(event) ?? null;

  db.insert(schema.responses)
    .values({
      id: responseId,
      formId: id,
      data: JSON.stringify(data),
      submittedAt: now,
      ip,
    })
    .run();

  return { success: true, id: responseId };
});

export const listResponses = defineEventHandler((event: H3Event) => {
  const id = getRouterParam(event, "id") as string;
  const query = getQuery(event);
  const limit = parseInt((query.limit as string) || "100", 10);

  // Verify form exists
  const form = db
    .select()
    .from(schema.forms)
    .where(eq(schema.forms.id, id))
    .get();
  if (!form) {
    setResponseStatus(event, 404);
    return { error: "Form not found" };
  }

  const rows = db
    .select()
    .from(schema.responses)
    .where(eq(schema.responses.formId, id))
    .orderBy(desc(schema.responses.submittedAt))
    .limit(limit)
    .all();

  const total = db
    .select({ count: sql<number>`count(*)` })
    .from(schema.responses)
    .where(eq(schema.responses.formId, id))
    .get();

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
