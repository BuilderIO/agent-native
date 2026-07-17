import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sweep = vi.hoisted(() => vi.fn());
const deleteExpired = vi.hoisted(() => vi.fn());
const getHeader = vi.hoisted(() => vi.fn());
const setResponseHeader = vi.hoisted(() => vi.fn());

vi.mock("../../../../lib/private-vault-retention.js", () => ({
  privateVaultRetentionService: { sweep },
}));
vi.mock("../../../../lib/private-vault-endpoint-request-nonces.js", () => ({
  sqlPrivateVaultEndpointRequestNonceStore: { deleteExpired },
}));
vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getHeader: (...args: unknown[]) => getHeader(...args),
  setResponseHeader: (...args: unknown[]) => setResponseHeader(...args),
  createError: (input: Record<string, unknown>) =>
    Object.assign(new Error(), input),
}));

import handler from "./run.get";

describe("Private Vault retention cron route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("CONTENT_PRIVATE_VAULT_RETENTION_CRON_SECRET_SHA256", "");
    vi.stubEnv("CONTENT_PRIVATE_VAULT_RETENTION_CRON_SECRET", "test-secret");
    getHeader.mockReturnValue("Bearer test-secret");
    sweep.mockResolvedValue({
      claimed: 2,
      purged: 2,
      failed: 0,
      evidencePurged: 3,
    });
    deleteExpired.mockResolvedValue(4);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails closed when the operator secret is absent", async () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("CONTENT_PRIVATE_VAULT_RETENTION_CRON_SECRET", "");
    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 503,
    });
    expect(sweep).not.toHaveBeenCalled();
    expect(deleteExpired).not.toHaveBeenCalled();
  });

  it("prefers Vercel's native cron secret", async () => {
    vi.stubEnv("CRON_SECRET", "vercel-secret");
    vi.stubEnv(
      "CONTENT_PRIVATE_VAULT_RETENTION_CRON_SECRET",
      "fallback-secret",
    );
    getHeader.mockReturnValue("Bearer vercel-secret");

    await expect(handler({} as never)).resolves.toMatchObject({ ok: true });
    expect(sweep).toHaveBeenCalledOnce();
  });

  it("prefers a one-way verifier when one is configured", async () => {
    vi.stubEnv(
      "CONTENT_PRIVATE_VAULT_RETENTION_CRON_SECRET_SHA256",
      createHash("sha256").update("verifier-secret").digest("hex"),
    );
    vi.stubEnv("CRON_SECRET", "different-runtime-value");
    getHeader.mockReturnValue("Bearer verifier-secret");

    await expect(handler({} as never)).resolves.toMatchObject({ ok: true });
    expect(sweep).toHaveBeenCalledOnce();
  });

  it("fails closed when the configured verifier is malformed", async () => {
    vi.stubEnv(
      "CONTENT_PRIVATE_VAULT_RETENTION_CRON_SECRET_SHA256",
      "not-a-sha256-digest",
    );
    getHeader.mockReturnValue("Bearer test-secret");

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 503,
    });
    expect(sweep).not.toHaveBeenCalled();
  });

  it("rejects malformed bearer headers in verifier mode", async () => {
    vi.stubEnv(
      "CONTENT_PRIVATE_VAULT_RETENTION_CRON_SECRET_SHA256",
      createHash("sha256").update("verifier-secret").digest("hex"),
    );
    getHeader.mockReturnValue("Bearer verifier-secret trailing");

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(sweep).not.toHaveBeenCalled();
  });

  it("uses a timing-safe bearer check before sweeping", async () => {
    getHeader.mockReturnValue("Bearer wrong-secret");
    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(sweep).not.toHaveBeenCalled();
  });

  it("returns only content-free cleanup counts", async () => {
    await expect(handler({} as never)).resolves.toEqual({
      ok: true,
      claimed: 2,
      purged: 2,
      failed: 0,
      evidencePurged: 3,
      replayClaimsDeleted: 4,
    });
    expect(setResponseHeader).toHaveBeenCalledWith(
      {},
      "Cache-Control",
      "no-store",
    );
  });
});
