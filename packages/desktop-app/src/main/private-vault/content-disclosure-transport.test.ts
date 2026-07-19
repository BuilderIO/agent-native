import {
  ancV1Hash,
  ancV1SignDetached,
  ancV1SigningKeypairFromSeed,
  encodeAncV1Canonical,
  E2EE_ENVELOPE_FIELDS,
} from "@agent-native/core/e2ee";
import { describe, expect, it, vi } from "vitest";

import {
  PrivateVaultContentDisclosureTransport,
  PrivateVaultContentDisclosureTransportError,
  verifyPrivateVaultDisclosureActivity,
} from "./content-disclosure-transport.js";

const p = (byte: number, length: number) => new Uint8Array(length).fill(byte);
const hex = (value: Uint8Array) => Buffer.from(value).toString("hex");

async function fixture() {
  const signing = await ancV1SigningKeypairFromSeed(p(0x44, 32));
  const vaultId = p(0x01, 16);
  const resourceId = p(0x02, 16);
  const grantRef = p(0x03, 32);
  const fields = E2EE_ENVELOPE_FIELDS.disclosure;
  const scopeHash = await ancV1Hash(
    "disclosure",
    encodeAncV1Canonical([resourceId, "get-document"]),
  );
  const unsigned = new Map<number, string | number | Uint8Array>([
    [1, "anc/v1"],
    [2, vaultId],
    [3, "disclosure"],
    [4, 1_721_131_200],
    [5, p(0x04, 16)],
    [fields.grantRef, grantRef],
    [fields.providerId, "codex-cli"],
    [fields.destination, "gpt-5.6"],
    [fields.scopeHash, scopeHash],
    [fields.issuedAt, 1_721_131_200],
    [fields.expiresAt, 1_721_132_100],
  ]);
  const signature = await ancV1SignDetached(
    "disclosure",
    encodeAncV1Canonical(unsigned),
    signing.privateKey,
  );
  const signedEnvelope = encodeAncV1Canonical(
    new Map<number, string | number | Uint8Array>([
      ...unsigned,
      [fields.signature, signature],
    ]),
  );
  const row = {
    disclosureId: hex(p(0x04, 16)),
    vaultId: hex(vaultId),
    endpointId: hex(p(0x05, 16)),
    jobId: hex(p(0x06, 16)),
    grantId: hex(p(0x07, 16)),
    resourceId: hex(resourceId),
    operation: "get-document",
    providerId: "codex-cli",
    destination: "gpt-5.6",
    outcome: "allowed" as const,
    issuedAt: "2024-07-16T12:00:00.000Z",
    expiresAt: "2024-07-16T12:15:00.000Z",
    serverReceivedAt: "2024-07-16T12:00:01.000Z",
    signedEnvelope: Buffer.from(signedEnvelope).toString("base64url"),
  };
  return { signing, row };
}

function hostedResponse(url: string, value: unknown): Response {
  const body = JSON.stringify(value);
  return {
    status: 200,
    url,
    redirected: false,
    headers: new Headers({
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(body)),
    }),
    arrayBuffer: async () => Buffer.from(body),
  } as unknown as Response;
}

describe("Private Vault disclosure activity transport", () => {
  it("accepts only exact hosted rows and verifies them against the native broker key", async () => {
    const { signing, row } = await fixture();
    const origin = "https://content.example.test";
    const url = `${origin}/api/private-vault/disclosures`;
    const fetch = vi.fn(async () =>
      hostedResponse(url, {
        version: 1,
        suite: "anc/v1",
        disclosures: [row],
      }),
    );
    const transport = new PrivateVaultContentDisclosureTransport({
      origin,
      session: { fetch },
    });
    const rows = await transport.list(row.vaultId);
    await expect(
      verifyPrivateVaultDisclosureActivity({
        vaultId: row.vaultId,
        brokerSigningPublicKey: signing.publicKey,
        rows,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        disclosureId: row.disclosureId,
        operation: "get-document",
        providerId: "codex-cli",
        destination: "gpt-5.6",
        outcome: "allowed",
      }),
    ]);
    expect(fetch).toHaveBeenCalledWith(url, {
      method: "GET",
      redirect: "error",
      credentials: "include",
      cache: "no-store",
      headers: expect.objectContaining({ "X-ANC-Vault-Id": row.vaultId }),
    });
  });

  it("rejects a server-authored destination that the broker did not sign", async () => {
    const { signing, row } = await fixture();
    const origin = "https://content.example.test";
    const url = `${origin}/api/private-vault/disclosures`;
    const transport = new PrivateVaultContentDisclosureTransport({
      origin,
      session: {
        fetch: async () =>
          hostedResponse(url, {
            version: 1,
            suite: "anc/v1",
            disclosures: [{ ...row, destination: "another-model" }],
          }),
      },
    });
    const rows = await transport.list(row.vaultId);
    await expect(
      verifyPrivateVaultDisclosureActivity({
        vaultId: row.vaultId,
        brokerSigningPublicKey: signing.publicKey,
        rows,
      }),
    ).rejects.toEqual(new PrivateVaultContentDisclosureTransportError());
  });
});
