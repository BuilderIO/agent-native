import {
  ANC_V1_VAULT_BOOTSTRAP_CONTROL_MAX_BYTES,
  decodeAncV1VaultBootstrapRequest,
} from "@agent-native/core/e2ee";
import {
  defineEventHandler,
  getHeader,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import { readPrivateVaultBootstrapPage } from "../../../lib/private-vault-bootstrap.js";
import { readPrivateVaultBoundedBody } from "../../../lib/private-vault-bounded-body.js";
import { resolveAuthenticatedPrivateVaultBootstrapScope } from "../../../lib/private-vault-genesis-account-scope.js";

const MEDIA_TYPE = "application/octet-stream";

function fail(event: Parameters<typeof setResponseStatus>[0], status: number) {
  setResponseStatus(event, status);
  return { error: status === 404 ? "Not found" : "Request unavailable" };
}

function positiveLength(value: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) return Number.NaN;
  return Number(value);
}

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");

  if (getHeader(event, "sec-fetch-site")?.trim() !== "same-origin") {
    return fail(event, 403);
  }

  const contentLength = positiveLength(
    getHeader(event, "content-length")?.trim() ?? "",
  );
  if (
    getHeader(event, "content-type")?.trim().toLowerCase() !== MEDIA_TYPE ||
    !Number.isSafeInteger(contentLength) ||
    contentLength > ANC_V1_VAULT_BOOTSTRAP_CONTROL_MAX_BYTES
  ) {
    return fail(event, 404);
  }
  const body = await readPrivateVaultBoundedBody(
    event,
    contentLength,
    ANC_V1_VAULT_BOOTSTRAP_CONTROL_MAX_BYTES,
  ).catch(() => null);
  if (!body || body.byteLength !== contentLength) return fail(event, 404);

  let request;
  try {
    request = decodeAncV1VaultBootstrapRequest(body);
  } catch {
    return fail(event, 404);
  }
  const scope = await resolveAuthenticatedPrivateVaultBootstrapScope(event);
  if (!scope) return fail(event, 404);

  try {
    const response = await readPrivateVaultBootstrapPage({ scope, request });
    setResponseHeader(event, "Content-Type", MEDIA_TYPE);
    setResponseHeader(event, "Content-Length", String(response.byteLength));
    return response;
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? error.code
        : "unavailable";
    if (code === "conflict") return fail(event, 409);
    if (code === "not_found") return fail(event, 404);
    return fail(event, 503);
  }
});
