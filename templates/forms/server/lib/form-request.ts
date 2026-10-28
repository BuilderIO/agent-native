import { getRequestHeader, setResponseHeader, type H3Event } from "h3";

import type { FormSettings } from "../../shared/types.js";

export function parseStoredFormSettings(
  value: string | null | undefined,
): FormSettings {
  let parsed: unknown;
  try {
    parsed = value ? JSON.parse(value) : {};
  } catch {
    throw new Error("Invalid form settings");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid form settings");
  }
  return parsed as FormSettings;
}

export function isPublicFormOriginAllowed(
  event: H3Event,
  settings: FormSettings,
): boolean {
  const allowedOrigins = settings.allowedOrigins;
  if (allowedOrigins === undefined) return true;
  if (!Array.isArray(allowedOrigins)) return false;

  const origin = getRequestHeader(event, "origin")?.trim();
  return allowedOrigins.length === 0
    ? true
    : origin !== undefined && allowedOrigins.includes(origin);
}

export function setPublicFormCors(
  event: H3Event,
  settings: FormSettings,
): void {
  const origin = getRequestHeader(event, "origin")?.trim();
  const allowedOrigins = settings.allowedOrigins;
  if (
    Array.isArray(allowedOrigins) &&
    origin &&
    allowedOrigins.includes(origin)
  ) {
    setResponseHeader(event, "Access-Control-Allow-Origin", origin);
    setResponseHeader(event, "Vary", "Origin");
  }
}
