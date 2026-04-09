import { defineEventHandler, setResponseStatus } from "h3";
import { credentialKeys } from "../../lib/credential-keys";
import { deleteSetting } from "@agent-native/core/settings";
import { readBody } from "@agent-native/core/server";

const ALLOWED_KEYS = new Set(credentialKeys.map((k) => k.key));
const SETTING_PREFIX = "credential:";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const { keys } = body as { keys?: string[] };

  if (!Array.isArray(keys) || keys.length === 0) {
    setResponseStatus(event, 400);
    return { error: "keys array required" };
  }

  const filtered = keys.filter(
    (k) => typeof k === "string" && ALLOWED_KEYS.has(k),
  );
  if (filtered.length === 0) {
    setResponseStatus(event, 400);
    return { error: "No recognized credential keys in request" };
  }

  for (const key of filtered) {
    await deleteSetting(`${SETTING_PREFIX}${key}`);
  }

  return { deleted: filtered };
});
