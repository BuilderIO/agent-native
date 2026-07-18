import {
  ANC_V1_GENESIS_ACCOUNT_ADMISSION_REQUEST_MAX_BYTES,
  endpointRequestProofSchema,
} from "@agent-native/core/e2ee";
import { getOrgContext } from "@agent-native/core/org";
import { getCurrentBetterAuthSession } from "@agent-native/core/server";
import {
  defineEventHandler,
  getHeader,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import { readPrivateVaultBoundedBody } from "../../../../lib/private-vault-bounded-body.js";
import { resolvePrivateVaultGenesisAccountScope } from "../../../../lib/private-vault-genesis-account-scope.js";
import {
  admitPrivateVaultGenesis,
  PrivateVaultGenesisAdmissionError,
} from "../../../../lib/private-vault-genesis-admission.js";

const MEDIA_TYPE = "application/vnd.agent-native.genesis-admission+cbor";
const PROOF_HEADER = "x-anc-endpoint-request-proof";

function header(event: Parameters<typeof getHeader>[0], name: string) {
  return getHeader(event, name)?.trim() ?? "";
}

function fail(event: Parameters<typeof setResponseStatus>[0], status: number) {
  setResponseStatus(event, status);
  return { error: status === 404 ? "Not found" : "Request unavailable" };
}

function parsePositiveInteger(value: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) return Number.NaN;
  return Number(value);
}

function parseProof(value: string) {
  if (!value || value.length > 8_192 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }
  try {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value || bytes.byteLength > 6_144) {
      return null;
    }
    return endpointRequestProofSchema.parse(JSON.parse(bytes.toString("utf8")));
  } catch {
    return null;
  }
}

function secureHeaders(event: Parameters<typeof setResponseHeader>[0]) {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");
}

export default defineEventHandler(async (event) => {
  secureHeaders(event);
  if (
    header(event, "x-agent-native-csrf") !== "1" &&
    header(event, "sec-fetch-site") !== "same-origin"
  ) {
    return fail(event, 403);
  }
  const session = await getCurrentBetterAuthSession(event).catch(() => null);
  if (!session?.email || !session.userId) return fail(event, 404);
  const org = await getOrgContext(event).catch(() => null);
  if (
    !org?.orgId ||
    org.email.trim().toLowerCase() !== session.email.trim().toLowerCase()
  ) {
    return fail(event, 404);
  }
  const scope = await resolvePrivateVaultGenesisAccountScope({
    userId: session.userId,
    email: session.email,
    orgId: org.orgId,
  });
  if (!scope) return fail(event, 404);

  const proof = parseProof(header(event, PROOF_HEADER));
  const contentLength = parsePositiveInteger(header(event, "content-length"));
  if (
    !proof ||
    header(event, "content-type").toLowerCase() !== MEDIA_TYPE ||
    !Number.isSafeInteger(contentLength) ||
    contentLength > ANC_V1_GENESIS_ACCOUNT_ADMISSION_REQUEST_MAX_BYTES
  ) {
    return fail(event, 400);
  }
  const body = await readPrivateVaultBoundedBody(
    event,
    contentLength,
    ANC_V1_GENESIS_ACCOUNT_ADMISSION_REQUEST_MAX_BYTES,
  ).catch(() => null);
  if (!body) return fail(event, 400);

  try {
    const receipt = await admitPrivateVaultGenesis({ scope, body, proof });
    setResponseHeader(event, "Content-Type", MEDIA_TYPE);
    setResponseHeader(event, "Content-Length", String(receipt.byteLength));
    return receipt;
  } catch (error) {
    if (error instanceof PrivateVaultGenesisAdmissionError) {
      if (error.code === "invalid_request") return fail(event, 400);
      if (error.code === "conflict") return fail(event, 409);
      if (error.code === "unavailable") return fail(event, 503);
    }
    return fail(event, 404);
  }
});
