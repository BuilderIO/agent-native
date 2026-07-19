import {
  defineEventHandler,
  getHeader,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import { readPrivateVaultBoundedBody } from "../../../../lib/private-vault-bounded-body.js";
import { resolveAuthenticatedPrivateVaultScope } from "../../../../lib/private-vault-genesis-account-scope.js";
import {
  PRIVATE_VAULT_OBJECT_MAX_BYTES,
  PrivateVaultObjectConflictError,
  PrivateVaultObjectNotFoundError,
  privateVaultObjectRevisionInputSchema,
  privateVaultObjectService,
} from "../../../../lib/private-vault-objects.js";

function secureHeaders(event: Parameters<typeof setResponseHeader>[0]) {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");
}

function fail(event: Parameters<typeof setResponseStatus>[0], status: number) {
  setResponseStatus(event, status);
  return { error: status === 404 ? "Not found" : "Request unavailable" };
}

function header(event: Parameters<typeof getHeader>[0], name: string) {
  return getHeader(event, name)?.trim() ?? "";
}

function parseInteger(value: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) return Number.NaN;
  return Number(value);
}

export default defineEventHandler(async (event) => {
  secureHeaders(event);
  if (
    header(event, "x-agent-native-csrf") !== "1" &&
    header(event, "sec-fetch-site") !== "same-origin"
  ) {
    return fail(event, 403);
  }
  const parentHeader = header(event, "x-anc-parent-revision-ids");
  let parentRevisionIds: unknown = [];
  try {
    parentRevisionIds = parentHeader
      ? JSON.parse(Buffer.from(parentHeader, "base64url").toString("utf8"))
      : [];
  } catch {
    return fail(event, 400);
  }
  const metadata = privateVaultObjectRevisionInputSchema.safeParse({
    vaultId: header(event, "x-anc-vault-id"),
    objectId: header(event, "x-anc-object-id"),
    revisionId: header(event, "x-anc-revision-id"),
    revision: parseInteger(header(event, "x-anc-revision")),
    objectType: header(event, "x-anc-object-type"),
    algorithmId: header(event, "x-anc-algorithm-id"),
    epoch: parseInteger(header(event, "x-anc-epoch")),
    parentRevisionIds,
    ciphertextByteLength: parseInteger(
      header(event, "x-anc-ciphertext-byte-length"),
    ),
  });
  if (!metadata.success) return fail(event, 400);
  const contentType = header(event, "content-type").toLowerCase();
  const contentLength = parseInteger(header(event, "content-length"));
  if (
    contentType !== "application/octet-stream" ||
    contentLength !== metadata.data.ciphertextByteLength ||
    contentLength > PRIVATE_VAULT_OBJECT_MAX_BYTES
  ) {
    return fail(event, 400);
  }

  const scope = await resolveAuthenticatedPrivateVaultScope(
    event,
    metadata.data.vaultId,
  );
  if (!scope) return fail(event, 404);
  try {
    // Parent authorization is deliberately complete before the body is read.
    await privateVaultObjectService.authorizePut(scope, metadata.data);
  } catch (error) {
    return error instanceof PrivateVaultObjectNotFoundError
      ? fail(event, 404)
      : fail(event, 409);
  }

  const raw = await readPrivateVaultBoundedBody(
    event,
    contentLength,
    PRIVATE_VAULT_OBJECT_MAX_BYTES,
  ).catch(() => undefined);
  if (!(raw instanceof Uint8Array) || raw.byteLength !== contentLength) {
    return fail(event, 400);
  }
  try {
    return await privateVaultObjectService.putRevision(scope, {
      ...metadata.data,
      ciphertext: raw,
    });
  } catch (error) {
    if (error instanceof PrivateVaultObjectNotFoundError)
      return fail(event, 404);
    if (error instanceof PrivateVaultObjectConflictError)
      return fail(event, 409);
    return fail(event, 503);
  }
});
