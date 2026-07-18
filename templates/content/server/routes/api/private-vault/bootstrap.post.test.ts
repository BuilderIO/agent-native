import {
  ANC_V1_VAULT_BOOTSTRAP_CONTROL_MAX_BYTES,
  encodeAncV1VaultBootstrapRequest,
} from "@agent-native/core/e2ee";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getHeader = vi.hoisted(() => vi.fn());
const readBody = vi.hoisted(() => vi.fn());
const resolveScope = vi.hoisted(() => vi.fn());
const readPage = vi.hoisted(() => vi.fn());
const setResponseHeader = vi.hoisted(() => vi.fn());
const setResponseStatus = vi.hoisted(() => vi.fn());

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getHeader: (...args: unknown[]) => getHeader(...args),
  setResponseHeader: (...args: unknown[]) => setResponseHeader(...args),
  setResponseStatus: (...args: unknown[]) => setResponseStatus(...args),
}));
vi.mock("../../../lib/private-vault-bounded-body.js", () => ({
  readPrivateVaultBoundedBody: (...args: unknown[]) => readBody(...args),
}));
vi.mock("../../../lib/private-vault-genesis-account-scope.js", () => ({
  resolveAuthenticatedPrivateVaultBootstrapScope: (...args: unknown[]) =>
    resolveScope(...args),
}));
vi.mock("../../../lib/private-vault-bootstrap.js", () => ({
  readPrivateVaultBootstrapPage: (...args: unknown[]) => readPage(...args),
}));

import handler from "./bootstrap.post";

const scope = {
  ownerEmail: "owner@example.test",
  orgId: "org-bootstrap",
  vaultId: "vault-bootstrap-0001",
};
const request = {
  version: 1,
  suite: "anc/v1",
  type: "vault-bootstrap-request",
  afterSequence: -1,
  expectedHead: null,
} as const;
const body = encodeAncV1VaultBootstrapRequest(request);

describe("POST /api/private-vault/bootstrap", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getHeader.mockImplementation((_event, name: string) =>
      name === "sec-fetch-site"
        ? "same-origin"
        : name === "content-type"
          ? "application/octet-stream"
          : name === "content-length"
            ? String(body.byteLength)
            : undefined,
    );
    readBody.mockResolvedValue(body);
    resolveScope.mockResolvedValue(scope);
    readPage.mockResolvedValue(Uint8Array.of(9, 8, 7));
  });

  it("returns an exact binary page for the current account's only vault", async () => {
    await expect(handler({} as never)).resolves.toEqual(Uint8Array.of(9, 8, 7));
    expect(readBody).toHaveBeenCalledWith(
      expect.anything(),
      body.byteLength,
      ANC_V1_VAULT_BOOTSTRAP_CONTROL_MAX_BYTES,
    );
    expect(readPage).toHaveBeenCalledWith({ scope, request });
    expect(setResponseHeader).toHaveBeenCalledWith(
      expect.anything(),
      "Content-Length",
      "3",
    );
  });

  it("rejects media, length, canonical-body, and account-scope failures", async () => {
    getHeader.mockImplementation((_event, name: string) =>
      name === "sec-fetch-site" ? "cross-site" : undefined,
    );
    await expect(handler({} as never)).resolves.toEqual({
      error: "Request unavailable",
    });
    expect(readBody).not.toHaveBeenCalled();

    getHeader.mockImplementation((_event, name: string) =>
      name === "sec-fetch-site"
        ? "same-origin"
        : name === "content-type"
          ? "application/json"
          : String(body.byteLength),
    );
    await expect(handler({} as never)).resolves.toEqual({ error: "Not found" });
    expect(readBody).not.toHaveBeenCalled();

    getHeader.mockImplementation((_event, name: string) =>
      name === "sec-fetch-site"
        ? "same-origin"
        : name === "content-type"
          ? "application/octet-stream"
          : "01",
    );
    await expect(handler({} as never)).resolves.toEqual({ error: "Not found" });

    getHeader.mockImplementation((_event, name: string) =>
      name === "sec-fetch-site"
        ? "same-origin"
        : name === "content-type"
          ? "application/octet-stream"
          : "2",
    );
    readBody.mockResolvedValueOnce(Uint8Array.of(1, 2));
    await expect(handler({} as never)).resolves.toEqual({ error: "Not found" });
    expect(resolveScope).not.toHaveBeenCalled();

    getHeader.mockImplementation((_event, name: string) =>
      name === "sec-fetch-site"
        ? "same-origin"
        : name === "content-type"
          ? "application/octet-stream"
          : String(body.byteLength),
    );
    readBody.mockResolvedValueOnce(body);
    resolveScope.mockResolvedValueOnce(null);
    await expect(handler({} as never)).resolves.toEqual({ error: "Not found" });
    expect(readPage).not.toHaveBeenCalled();
  });

  it("maps pinned-head conflicts and storage failures without diagnostics", async () => {
    readPage.mockRejectedValueOnce({ code: "conflict", secret: "do not leak" });
    await expect(handler({} as never)).resolves.toEqual({
      error: "Request unavailable",
    });
    expect(setResponseStatus).toHaveBeenLastCalledWith(expect.anything(), 409);

    readPage.mockRejectedValueOnce(new Error("private storage diagnostic"));
    await expect(handler({} as never)).resolves.toEqual({
      error: "Request unavailable",
    });
    expect(setResponseStatus).toHaveBeenLastCalledWith(expect.anything(), 503);
  });
});
