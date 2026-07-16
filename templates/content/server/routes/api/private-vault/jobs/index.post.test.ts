import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());
const getHeader = vi.hoisted(() => vi.fn());
const readPrivateVaultBoundedBody = vi.hoisted(() => vi.fn());
const setResponseHeader = vi.hoisted(() => vi.fn());
const setResponseStatus = vi.hoisted(() => vi.fn());
const authorizeEnqueue = vi.hoisted(() => vi.fn());
const enqueue = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  getSession: (...args: unknown[]) => getSession(...args),
}));
vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getHeader: (...args: unknown[]) => getHeader(...args),
  setResponseHeader: (...args: unknown[]) => setResponseHeader(...args),
  setResponseStatus: (...args: unknown[]) => setResponseStatus(...args),
}));
vi.mock("../../../../lib/private-vault-bounded-body.js", () => ({
  readPrivateVaultBoundedBody: (...args: unknown[]) =>
    readPrivateVaultBoundedBody(...args),
}));
vi.mock("../../../../lib/private-vault-jobs.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../../lib/private-vault-jobs.js")
    >();
  return { ...actual, privateVaultJobService: { authorizeEnqueue, enqueue } };
});

import { PrivateVaultJobNotFoundError } from "../../../../lib/private-vault-jobs.js";
import handler from "./index.post";

const headers: Record<string, string> = {
  "sec-fetch-site": "same-origin",
  "content-type": "application/octet-stream",
  "content-length": "4",
  "x-anc-vault-id": "vault:test",
  "x-anc-job-id": "job:test",
  "x-anc-grant-id": "grant:test",
  "x-anc-recipient-endpoint-id": "endpoint:test",
  "x-anc-epoch": "1",
  "x-anc-algorithm-id": "anc-v1",
  "x-anc-ciphertext-byte-length": "4",
  "x-anc-issued-at": "2026-07-16T12:00:00.000Z",
  "x-anc-expires-at": "2026-07-16T13:00:00.000Z",
};

describe("POST /api/private-vault/jobs", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getHeader.mockImplementation((_event, name: string) => headers[name]);
    getSession.mockResolvedValue({
      email: "owner@example.com",
      orgId: "org:test",
    });
    authorizeEnqueue.mockResolvedValue(undefined);
    readPrivateVaultBoundedBody.mockResolvedValue(
      Uint8Array.from([1, 2, 3, 4]),
    );
    enqueue.mockResolvedValue({ jobId: "job:test", state: "queued" });
  });

  it("checks CSRF before session or body", async () => {
    getHeader.mockReturnValue(undefined);
    await handler({} as never);
    expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 403);
    expect(getSession).not.toHaveBeenCalled();
    expect(readPrivateVaultBoundedBody).not.toHaveBeenCalled();
  });

  it("authorizes owner, vault, grant, and endpoint metadata before reading ciphertext", async () => {
    authorizeEnqueue.mockRejectedValue(new PrivateVaultJobNotFoundError());
    await expect(handler({} as never)).resolves.toEqual({ error: "Not found" });
    expect(readPrivateVaultBoundedBody).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("relays exact bytes without provider locators or plaintext-shaped fields", async () => {
    const result = await handler({} as never);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerEmail: "owner@example.com",
        vaultId: "vault:test",
      }),
      expect.objectContaining({ ciphertext: Uint8Array.from([1, 2, 3, 4]) }),
    );
    expect(JSON.stringify(result)).toBe(
      '{"jobId":"job:test","state":"queued"}',
    );
    expect(setResponseHeader).toHaveBeenCalledWith(
      expect.anything(),
      "Cache-Control",
      "no-store",
    );
  });
});
