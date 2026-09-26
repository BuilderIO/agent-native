import {
  defineEventHandler,
  getRequestURL,
  setResponseStatus,
  type H3Event,
} from "h3";

import { toPublicFormSettings, type FormSettings } from "../../shared/types.js";
import { getDb } from "../db/index.js";
import { findFormBySlugOrId } from "../lib/form-lookup.js";


export const getPublicForm = defineEventHandler(async (event: H3Event) => {
  const url = getRequestURL(event).pathname;
  const afterPublic = url.split("/api/forms/public/")[1] || "";
  const slug = decodeURIComponent(afterPublic);

  if (!slug) {
    setResponseStatus(event, 404);
    return { error: "Form not found" };
  }

  const row = await findFormBySlugOrId(getDb(), slug);

  if (!row || row.status !== "published" || row.deletedAt) {
    setResponseStatus(event, 404);
    return { error: "Form not found" };
  }

  const settings = JSON.parse(row.settings) as FormSettings;
  const result = {
    id: row.id,
    updatedAt: row.updatedAt,
    title: row.title,
    description: row.description,
    fields: JSON.parse(row.fields),
    settings: toPublicFormSettings(settings),
  };

  return result;
});
