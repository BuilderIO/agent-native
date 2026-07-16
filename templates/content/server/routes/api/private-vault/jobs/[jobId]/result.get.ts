import { getSession } from "@agent-native/core/server";
import {
  defineEventHandler,
  getHeader,
  getRouterParam,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import {
  PrivateVaultJobNotFoundError,
  privateVaultJobService,
} from "../../../../../lib/private-vault-jobs.js";

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    setResponseStatus(event, 404);
    return { error: "Not found" };
  }
  try {
    const output = await privateVaultJobService.getResult(
      {
        ownerEmail: session.email,
        orgId: session.orgId ?? "",
        vaultId: getHeader(event, "x-anc-vault-id")?.trim() ?? "",
      },
      getRouterParam(event, "jobId") ?? "",
    );
    setResponseHeader(event, "Content-Type", "application/octet-stream");
    setResponseHeader(
      event,
      "X-ANC-Ciphertext-Byte-Length",
      String(output.result.ciphertextByteLength),
    );
    setResponseHeader(event, "X-ANC-Algorithm-Id", output.result.algorithmId);
    setResponseHeader(event, "X-ANC-Epoch", String(output.result.epoch));
    setResponseHeader(event, "X-ANC-Job-Hash", output.result.jobHash);
    setResponseHeader(event, "X-ANC-Job-State", output.result.state);
    return output.ciphertext;
  } catch (error) {
    setResponseStatus(
      event,
      error instanceof PrivateVaultJobNotFoundError ? 404 : 503,
    );
    return error instanceof PrivateVaultJobNotFoundError
      ? { error: "Not found" }
      : { error: "Request unavailable" };
  }
});
