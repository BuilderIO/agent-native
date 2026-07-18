import {
  ANC_V1_CONTROL_LOG_APPEND_REQUEST_MAX_BYTES,
  decodeAncV1ControlLogGenesisAppendRequest,
  decodeAncV1ControlLogRotationAppendRequest,
  decodeAncV1ControlLogRecoveryAppendRequest,
  endpointRequestProofSchema,
} from "@agent-native/core/e2ee";
import {
  defineEventHandler,
  getHeader,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import { readPrivateVaultBoundedBody } from "../../../../lib/private-vault-bounded-body.js";
import {
  appendPrivateVaultControlLogGenesis,
  appendPrivateVaultControlLogRotation,
  appendPrivateVaultControlLogRecovery,
  PrivateVaultControlLogAppendError,
} from "../../../../lib/private-vault-control-log-append.js";

const PROOF_HEADER = "x-anc-endpoint-request-proof";
const REQUEST_TYPE = "application/vnd.agent-native.control-log+cbor";

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

function requestKind(
  body: Uint8Array,
): "genesis" | "rotation" | "recovery" | null {
  try {
    decodeAncV1ControlLogRecoveryAppendRequest(body);
    return "recovery";
  } catch {
    // Continue through the two smaller, disjoint append envelopes.
  }
  try {
    decodeAncV1ControlLogGenesisAppendRequest(body);
    return "genesis";
  } catch {
    try {
      decodeAncV1ControlLogRotationAppendRequest(body);
      return "rotation";
    } catch {
      return null;
    }
  }
}

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");

  const proof = parseProof(getHeader(event, PROOF_HEADER)?.trim() ?? "");
  const contentLength = parsePositiveInteger(
    getHeader(event, "content-length")?.trim() ?? "",
  );
  if (
    !proof ||
    getHeader(event, "content-type")?.trim().toLowerCase() !== REQUEST_TYPE ||
    !Number.isSafeInteger(contentLength) ||
    contentLength > ANC_V1_CONTROL_LOG_APPEND_REQUEST_MAX_BYTES
  ) {
    return fail(event, 404);
  }
  const body = await readPrivateVaultBoundedBody(
    event,
    contentLength,
    ANC_V1_CONTROL_LOG_APPEND_REQUEST_MAX_BYTES,
  ).catch(() => null);
  if (!body) return fail(event, 404);
  const kind = requestKind(body);
  if (!kind) return fail(event, 404);

  try {
    const receipt = await (kind === "genesis"
      ? appendPrivateVaultControlLogGenesis({ body, proof })
      : kind === "recovery"
        ? appendPrivateVaultControlLogRecovery({ body, proof })
        : appendPrivateVaultControlLogRotation({ body, proof }));
    setResponseHeader(event, "Content-Type", REQUEST_TYPE);
    setResponseHeader(event, "Content-Length", String(receipt.byteLength));
    return receipt;
  } catch (error) {
    if (error instanceof PrivateVaultControlLogAppendError) {
      if (error.code === "conflict") return fail(event, 409);
      if (error.code === "unavailable") return fail(event, 503);
    }
    return fail(event, 404);
  }
});
