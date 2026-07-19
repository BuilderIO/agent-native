import {
  defineEventHandler,
  getHeader,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import { readPrivateVaultBoundedBody } from "../../../../lib/private-vault-bounded-body.js";
import { resolveAuthenticatedPrivateVaultScope } from "../../../../lib/private-vault-genesis-account-scope.js";
import {
  PRIVATE_VAULT_GRANT_MAX_BYTES,
  PrivateVaultGrantNotFoundError,
  privateVaultGrantInputSchema,
  privateVaultGrantService,
} from "../../../../lib/private-vault-grants.js";

function header(event: Parameters<typeof getHeader>[0], name: string) {
  return getHeader(event, name)?.trim() ?? "";
}
function integer(value: string) {
  return /^[1-9][0-9]*$/.test(value) ? Number(value) : Number.NaN;
}
function fail(event: Parameters<typeof setResponseStatus>[0], status: number) {
  setResponseStatus(event, status);
  return { error: status === 404 ? "Not found" : "Request unavailable" };
}

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");
  if (
    header(event, "x-agent-native-csrf") !== "1" &&
    header(event, "sec-fetch-site") !== "same-origin"
  )
    return fail(event, 403);
  const metadata = privateVaultGrantInputSchema.safeParse({
    vaultId: header(event, "x-anc-vault-id"),
    grantId: header(event, "x-anc-grant-id"),
    recipientEndpointId: header(event, "x-anc-recipient-endpoint-id"),
    algorithmId: header(event, "x-anc-algorithm-id"),
    ciphertextByteLength: integer(
      header(event, "x-anc-ciphertext-byte-length"),
    ),
    issuedAt: header(event, "x-anc-issued-at"),
    expiresAt: header(event, "x-anc-expires-at"),
  });
  if (!metadata.success) return fail(event, 400);
  const contentLength = integer(header(event, "content-length"));
  if (
    header(event, "content-type").toLowerCase() !==
      "application/octet-stream" ||
    contentLength !== metadata.data.ciphertextByteLength ||
    contentLength > PRIVATE_VAULT_GRANT_MAX_BYTES
  )
    return fail(event, 400);
  const scope = await resolveAuthenticatedPrivateVaultScope(
    event,
    metadata.data.vaultId,
  );
  if (!scope) return fail(event, 404);
  try {
    await privateVaultGrantService.authorize(scope, metadata.data);
  } catch {
    return fail(event, 404);
  }
  const ciphertext = await readPrivateVaultBoundedBody(
    event,
    contentLength,
    PRIVATE_VAULT_GRANT_MAX_BYTES,
  ).catch(() => undefined);
  if (
    !(ciphertext instanceof Uint8Array) ||
    ciphertext.byteLength !== contentLength
  )
    return fail(event, 400);
  try {
    return await privateVaultGrantService.create(scope, {
      ...metadata.data,
      ciphertext,
    });
  } catch (error) {
    return fail(
      event,
      error instanceof PrivateVaultGrantNotFoundError ? 404 : 503,
    );
  }
});
