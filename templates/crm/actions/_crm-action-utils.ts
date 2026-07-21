import type { ActionRunContext } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";

export {
  isBoundedCrmValue,
  isSafeCrmMutationFieldName,
  isSafeCrmMutationFields,
} from "../server/crm/crm-field-firewall.js";

export const MAX_CRM_FIELDS_PER_MUTATION = 20;

export function requireCrmScope(ctx?: ActionRunContext) {
  const ownerEmail = ctx?.userEmail ?? getRequestUserEmail();
  if (!ownerEmail) throw new Error("Sign in is required to manage CRM data.");
  const orgId = ctx?.orgId ?? getRequestOrgId() ?? null;
  return {
    ownerEmail,
    orgId,
    visibility: orgId ? ("org" as const) : ("private" as const),
  };
}

export function crmInitiatedBy(ctx?: ActionRunContext) {
  return ctx?.caller === "tool" ||
    ctx?.caller === "mcp" ||
    ctx?.caller === "a2a"
    ? ("agent" as const)
    : ("human" as const);
}

export function crmWriteRisk(fieldNames: string[]) {
  const names = fieldNames.map((field) => field.toLowerCase());
  if (names.some((field) => field.includes("owner")))
    return "ownership" as const;
  if (names.some((field) => field === "amount" || field.includes("amount"))) {
    return "amount" as const;
  }
  if (
    names.some((field) => field.includes("stage") || field.includes("pipeline"))
  ) {
    return "stage" as const;
  }
  return "routine" as const;
}

export async function scopedCrmIdempotencyKey(input: {
  ownerEmail: string;
  orgId: string | null;
  recordId: string;
  key: string;
}): Promise<string> {
  const value = [
    "crm-mutation-v1",
    input.ownerEmail.toLowerCase(),
    input.orgId ?? "",
    input.recordId,
    input.key,
  ].join("\u0000");
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `crm:v1:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

export function toJson(value: unknown, maxChars: number) {
  const encoded = JSON.stringify(value);
  if (encoded.length > maxChars) {
    throw new Error(`CRM payload exceeds the ${maxChars}-character limit.`);
  }
  return encoded;
}

export function parseJsonRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
