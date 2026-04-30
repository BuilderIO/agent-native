import { defineEventHandler, setResponseStatus } from "h3";
import { credentialKeys } from "../../lib/credential-keys";
import {
  deleteCredential,
  getCredentialContextFromEvent,
} from "../../lib/credentials";
import { readBody } from "@agent-native/core/server";

const ALLOWED_KEYS = new Set(credentialKeys.map((k) => k.key));

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

  const ctx = await getCredentialContextFromEvent(event);
  if (!ctx) {
    setResponseStatus(event, 401);
    return { error: "Sign in to delete credentials" };
  }

  for (const key of filtered) {
    await deleteCredential(key, ctx);
  }

  return { deleted: filtered };
});
