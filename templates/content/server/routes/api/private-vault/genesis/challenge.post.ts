import { ANC_V1_GENESIS_ACCOUNT_ADMISSION_CANDIDATE_MAX_BYTES } from "@agent-native/core/e2ee";
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
  issuePrivateVaultGenesisChallenge,
  PrivateVaultGenesisAdmissionError,
} from "../../../../lib/private-vault-genesis-admission.js";

const REQUEST_TYPE =
  "application/vnd.agent-native.genesis-admission-candidate+cbor";
const RESPONSE_TYPE =
  "application/vnd.agent-native.genesis-admission-challenge+cbor";

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

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");
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

  const contentLength = parsePositiveInteger(header(event, "content-length"));
  if (
    header(event, "content-type").toLowerCase() !== REQUEST_TYPE ||
    !Number.isSafeInteger(contentLength) ||
    contentLength > ANC_V1_GENESIS_ACCOUNT_ADMISSION_CANDIDATE_MAX_BYTES
  ) {
    return fail(event, 400);
  }
  const candidate = await readPrivateVaultBoundedBody(
    event,
    contentLength,
    ANC_V1_GENESIS_ACCOUNT_ADMISSION_CANDIDATE_MAX_BYTES,
  ).catch(() => null);
  if (!candidate) return fail(event, 400);

  try {
    const challenge = await issuePrivateVaultGenesisChallenge({
      scope,
      candidate,
    });
    setResponseHeader(event, "Content-Type", RESPONSE_TYPE);
    setResponseHeader(event, "Content-Length", String(challenge.byteLength));
    return challenge;
  } catch (error) {
    if (error instanceof PrivateVaultGenesisAdmissionError) {
      if (error.code === "invalid_request") return fail(event, 400);
      if (error.code === "conflict") return fail(event, 409);
      if (error.code === "unavailable") return fail(event, 503);
    }
    return fail(event, 404);
  }
});
