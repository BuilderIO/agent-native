import { describe, expect, it } from "vitest";

import {
  decodeAncV1BrokerDisclosureRequest,
  decodeAncV1BrokerDisclosureResponse,
  encodeAncV1BrokerDisclosureRequest,
  encodeAncV1BrokerDisclosureResponse,
  verifyAncV1BrokerDisclosure,
} from "./broker-disclosure-protocol.js";
import { ancV1BytesToHex, encodeAncV1Canonical } from "./canonical.js";
import {
  ancV1Hash,
  ancV1SignDetached,
  ancV1SigningKeypairFromSeed,
} from "./portable-crypto.js";
import { E2EE_ENVELOPE_FIELDS } from "./suite.js";

const p = (byte: number, length: number) => new Uint8Array(length).fill(byte);

describe("anc/v1 broker disclosure protocol", () => {
  it("verifies exact broker signature, scope, provider, and destination", async () => {
    const signing = await ancV1SigningKeypairFromSeed(p(0x44, 32));
    const vaultId = p(0x01, 16);
    const resourceId = p(0x02, 16);
    const grantRef = p(0x03, 32);
    const operation = "get-document";
    const providerId = "codex-cli";
    const destination = "gpt-5.6";
    const scopeHash = await ancV1Hash(
      "disclosure",
      encodeAncV1Canonical([resourceId, operation]),
    );
    const fields = E2EE_ENVELOPE_FIELDS.disclosure;
    const unsigned = new Map([
      [1, "anc/v1"],
      [2, vaultId],
      [3, "disclosure"],
      [4, 100],
      [5, p(0x04, 16)],
      [fields.grantRef, grantRef],
      [fields.providerId, providerId],
      [fields.destination, destination],
      [fields.scopeHash, scopeHash],
      [fields.issuedAt, 100],
      [fields.expiresAt, 200],
    ]);
    const signature = await ancV1SignDetached(
      "disclosure",
      encodeAncV1Canonical(unsigned),
      signing.privateKey,
    );
    const signedEnvelope = encodeAncV1Canonical(
      new Map([...unsigned, [fields.signature, signature]]),
    );
    const request = {
      version: 1 as const,
      suite: "anc/v1" as const,
      type: "broker-disclosure-request" as const,
      vaultId: ancV1BytesToHex(vaultId),
      endpointId: ancV1BytesToHex(p(0x05, 16)),
      jobId: ancV1BytesToHex(p(0x06, 16)),
      grantId: ancV1BytesToHex(p(0x07, 16)),
      resourceId: ancV1BytesToHex(resourceId),
      operation,
      providerId,
      destination,
      outcome: "allowed" as const,
      signedEnvelope,
    };
    const decoded = decodeAncV1BrokerDisclosureRequest(
      encodeAncV1BrokerDisclosureRequest(request),
    );
    await expect(
      verifyAncV1BrokerDisclosure({
        request: decoded,
        brokerSigningPublicKey: signing.publicKey,
        nowSeconds: 150,
      }),
    ).resolves.toMatchObject({
      disclosureId: ancV1BytesToHex(p(0x04, 16)),
      grantRef: ancV1BytesToHex(grantRef),
      scopeHash: ancV1BytesToHex(scopeHash),
      providerId,
      destination,
    });
    await expect(
      verifyAncV1BrokerDisclosure({
        request: { ...decoded, destination: "another-model" },
        brokerSigningPublicKey: signing.publicKey,
        nowSeconds: 150,
      }),
    ).rejects.toThrow();

    const response = {
      version: 1 as const,
      suite: "anc/v1" as const,
      type: "broker-disclosure-response" as const,
      disclosureId: ancV1BytesToHex(p(0x04, 16)),
      state: "stored" as const,
    };
    expect(
      decodeAncV1BrokerDisclosureResponse(
        encodeAncV1BrokerDisclosureResponse(response),
      ),
    ).toEqual(response);
  });
});
