import { getSession } from "@agent-native/core/server";
import {
  defineEventHandler,
  getHeader,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import { readPrivateVaultBoundedBody } from "../../../../lib/private-vault-bounded-body.js";
import {
  PRIVATE_VAULT_JOB_MAX_BYTES,
  PrivateVaultJobNotFoundError,
  privateVaultJobInputSchema,
  privateVaultJobService,
} from "../../../../lib/private-vault-jobs.js";

function secure(event: Parameters<typeof setResponseHeader>[0]) {
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
function integer(value: string) {
  return /^[1-9][0-9]*$/.test(value) ? Number(value) : Number.NaN;
}

export default defineEventHandler(async (event) => {
  secure(event);
  if (
    header(event, "x-agent-native-csrf") !== "1" &&
    header(event, "sec-fetch-site") !== "same-origin"
  )
    return fail(event, 403);
  const session = await getSession(event).catch(() => null);
  if (!session?.email) return fail(event, 404);
  const metadata = privateVaultJobInputSchema.safeParse({
    vaultId: header(event, "x-anc-vault-id"),
    jobId: header(event, "x-anc-job-id"),
    grantId: header(event, "x-anc-grant-id"),
    recipientEndpointId: header(event, "x-anc-recipient-endpoint-id"),
    epoch: integer(header(event, "x-anc-epoch")),
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
    contentLength > PRIVATE_VAULT_JOB_MAX_BYTES
  )
    return fail(event, 400);
  const scope = {
    ownerEmail: session.email,
    orgId: session.orgId ?? "",
    vaultId: metadata.data.vaultId,
  };
  try {
    await privateVaultJobService.authorizeEnqueue(scope, metadata.data);
  } catch (error) {
    return fail(
      event,
      error instanceof PrivateVaultJobNotFoundError ? 404 : 400,
    );
  }
  const ciphertext = await readPrivateVaultBoundedBody(
    event,
    contentLength,
    PRIVATE_VAULT_JOB_MAX_BYTES,
  ).catch(() => undefined);
  if (
    !(ciphertext instanceof Uint8Array) ||
    ciphertext.byteLength !== contentLength
  )
    return fail(event, 400);
  try {
    return await privateVaultJobService.enqueue(scope, {
      ...metadata.data,
      ciphertext,
    });
  } catch (error) {
    return fail(
      event,
      error instanceof PrivateVaultJobNotFoundError ? 404 : 503,
    );
  }
});
