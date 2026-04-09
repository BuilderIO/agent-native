import { defineEventHandler, setResponseStatus } from "h3";
import { saveCredential } from "../../lib/credentials";
import { credentialKeys } from "../../lib/credential-keys";
import { readBody } from "@agent-native/core/server";

const ALLOWED_KEYS = new Set(credentialKeys.map((k) => k.key));

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const { vars } = body as {
    vars?: Array<{ key: string; value: string }>;
  };

  if (!Array.isArray(vars) || vars.length === 0) {
    setResponseStatus(event, 400);
    return { error: "vars array required" };
  }

  const filtered = vars.filter(
    (v) => typeof v.key === "string" && ALLOWED_KEYS.has(v.key) && v.value,
  );
  if (filtered.length === 0) {
    setResponseStatus(event, 400);
    return { error: "No recognized credential keys in request" };
  }

  for (const { key, value } of filtered) {
    await saveCredential(key, value.trim());
  }

  return { saved: filtered.map((v) => v.key) };
});
