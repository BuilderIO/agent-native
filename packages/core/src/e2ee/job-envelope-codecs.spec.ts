import { describe, expect, it, vi } from "vitest";

import {
  decodeAncV1Canonical,
  encodeAncV1Canonical,
  type AncV1CanonicalValue,
} from "./canonical.js";
import {
  AncV1JobEnvelopeError,
  decodeAncV1SemanticJobPayload,
  encodeAncV1SemanticJobPayload,
  openAncV1JobEnvelope,
  openAncV1ResultEnvelope,
  parseAncV1ResultEnvelopeCoordinates,
  sealAncV1JobEnvelope,
  sealAncV1ResultEnvelope,
} from "./job-envelope-codecs.js";
import {
  ancV1BoxKeypairFromSeed,
  ancV1SigningKeypairFromSeed,
} from "./portable-crypto.js";
import { E2EE_ENVELOPE_FIELDS } from "./suite.js";

const p = (byte: number, length: number) => new Uint8Array(length).fill(byte);
const text = (value: string) => new TextEncoder().encode(value);

function map(encoded: Uint8Array): Map<number, AncV1CanonicalValue> {
  return decodeAncV1Canonical(encoded, {
    maxBytes: 17 * 1024 * 1024,
  }) as Map<number, AncV1CanonicalValue>;
}

async function fixture() {
  const authorizer = await ancV1SigningKeypairFromSeed(p(0x11, 32));
  const broker = await ancV1SigningKeypairFromSeed(p(0x12, 32));
  const requesterBox = await ancV1BoxKeypairFromSeed(p(0x13, 32));
  const brokerBox = await ancV1BoxKeypairFromSeed(p(0x14, 32));
  return {
    authorizer,
    broker,
    requesterBox,
    brokerBox,
    vaultId: p(0x21, 16),
    jobId: p(0x22, 16),
    requesterId: p(0x23, 16),
    brokerId: p(0x24, 16),
    grantRef: p(0x25, 32),
  };
}

describe("anc/v1 encrypted job envelopes", () => {
  it("round-trips only a strict semantic resource, operation, provider, and body", () => {
    const encoded = encodeAncV1SemanticJobPayload({
      resourceId: p(0x09, 16),
      operation: "read",
      provider: "content",
      body: text('{"action":"get-document"}'),
      disclosureProviderId: "synthetic-provider",
      disclosureDestination: "synthetic-destination",
    });
    expect(Buffer.from(encoded).toString("hex")).toBe(
      "a80166616e632f7631026c73656d616e7469632d6a6f620350090909090909090909090909090909090464726561640567636f6e74656e740658197b22616374696f6e223a226765742d646f63756d656e74227d077273796e7468657469632d70726f7669646572087573796e7468657469632d64657374696e6174696f6e",
    );
    expect(decodeAncV1SemanticJobPayload(encoded)).toEqual({
      resourceId: p(0x09, 16),
      operation: "read",
      provider: "content",
      body: text('{"action":"get-document"}'),
      disclosureProviderId: "synthetic-provider",
      disclosureDestination: "synthetic-destination",
    });

    const extra = map(encoded);
    extra.set(9, "hosted-override");
    expect(() =>
      decodeAncV1SemanticJobPayload(encodeAncV1Canonical(extra)),
    ).toThrow(AncV1JobEnvelopeError);
    expect(() =>
      encodeAncV1SemanticJobPayload({
        resourceId: p(0x09, 16),
        operation: "read\nadmin",
        provider: "content",
        body: new Uint8Array(),
        disclosureProviderId: "synthetic-provider",
        disclosureDestination: "synthetic-destination",
      }),
    ).toThrow(AncV1JobEnvelopeError);
  });

  it("binds job identity, grant, recipient, lifetime, and exact signed bytes", async () => {
    const f = await fixture();
    const encoded = await sealAncV1JobEnvelope({
      vaultId: f.vaultId,
      envelopeId: p(0x31, 16),
      createdAt: 100,
      jobId: f.jobId,
      grantRef: f.grantRef,
      issuedAt: 100,
      expiresAt: 200,
      recipientEndpointId: f.brokerId,
      plaintext: text("list my encrypted documents"),
      nonce: p(0x32, 24),
      senderKeyAgreementPrivateKey: f.requesterBox.privateKey,
      recipientKeyAgreementPublicKey: f.brokerBox.publicKey,
      signingPrivateKey: f.authorizer.privateKey,
    });
    const resolveGrantSenderKeys = vi.fn(() => ({
      signingPublicKey: f.authorizer.publicKey.slice(),
      keyAgreementPublicKey: f.requesterBox.publicKey.slice(),
    }));
    const opened = await openAncV1JobEnvelope({
      encoded,
      expectedVaultId: f.vaultId,
      expectedJobId: f.jobId,
      expectedRecipientEndpointId: f.brokerId,
      recipientKeyAgreementPrivateKey: f.brokerBox.privateKey,
      nowSeconds: 150,
      resolveGrantSenderKeys,
    });

    expect(new TextDecoder().decode(opened.plaintext)).toBe(
      "list my encrypted documents",
    );
    expect(opened.grantRef).toEqual(f.grantRef);
    expect(opened.jobHash).toHaveLength(32);
    expect(resolveGrantSenderKeys).toHaveBeenCalledOnce();
    expect(resolveGrantSenderKeys).toHaveBeenCalledWith(f.grantRef);

    const createdAfterIssue = map(encoded);
    createdAfterIssue.set(E2EE_ENVELOPE_FIELDS.common.createdAt, 101);
    const invalidCreatedAtResolver = vi.fn(() => ({
      signingPublicKey: f.authorizer.publicKey.slice(),
      keyAgreementPublicKey: f.requesterBox.publicKey.slice(),
    }));
    await expect(
      openAncV1JobEnvelope({
        encoded: encodeAncV1Canonical(createdAfterIssue),
        expectedVaultId: f.vaultId,
        expectedJobId: f.jobId,
        expectedRecipientEndpointId: f.brokerId,
        recipientKeyAgreementPrivateKey: f.brokerBox.privateKey,
        nowSeconds: 150,
        resolveGrantSenderKeys: invalidCreatedAtResolver,
      }),
    ).rejects.toBeInstanceOf(AncV1JobEnvelopeError);
    expect(invalidCreatedAtResolver).not.toHaveBeenCalled();

    await expect(
      openAncV1JobEnvelope({
        encoded,
        expectedVaultId: f.vaultId,
        expectedJobId: f.jobId,
        expectedRecipientEndpointId: p(0xff, 16),
        recipientKeyAgreementPrivateKey: f.brokerBox.privateKey,
        nowSeconds: 150,
        resolveGrantSenderKeys,
      }),
    ).rejects.toBeInstanceOf(AncV1JobEnvelopeError);
    await expect(
      openAncV1JobEnvelope({
        encoded,
        expectedVaultId: f.vaultId,
        expectedJobId: f.jobId,
        expectedRecipientEndpointId: f.brokerId,
        recipientKeyAgreementPrivateKey: f.brokerBox.privateKey,
        nowSeconds: 201,
        resolveGrantSenderKeys,
      }),
    ).rejects.toBeInstanceOf(AncV1JobEnvelopeError);
  });

  it("verifies the grant-authorized signature before releasing plaintext", async () => {
    const f = await fixture();
    const encoded = await sealAncV1JobEnvelope({
      vaultId: f.vaultId,
      envelopeId: p(0x31, 16),
      createdAt: 100,
      jobId: f.jobId,
      grantRef: f.grantRef,
      issuedAt: 100,
      expiresAt: 200,
      recipientEndpointId: f.brokerId,
      plaintext: text("private request"),
      nonce: p(0x32, 24),
      senderKeyAgreementPrivateKey: f.requesterBox.privateKey,
      recipientKeyAgreementPublicKey: f.brokerBox.publicKey,
      signingPrivateKey: f.authorizer.privateKey,
    });
    const tampered = map(encoded);
    const packed = (
      tampered.get(E2EE_ENVELOPE_FIELDS.job.ciphertext) as Uint8Array
    ).slice();
    packed[packed.length - 1] ^= 1;
    tampered.set(E2EE_ENVELOPE_FIELDS.job.ciphertext, packed);
    const resolver = vi.fn(() => ({
      signingPublicKey: f.authorizer.publicKey,
      keyAgreementPublicKey: f.requesterBox.publicKey,
    }));

    await expect(
      openAncV1JobEnvelope({
        encoded: encodeAncV1Canonical(tampered),
        expectedVaultId: f.vaultId,
        expectedJobId: f.jobId,
        expectedRecipientEndpointId: f.brokerId,
        recipientKeyAgreementPrivateKey: f.brokerBox.privateKey,
        nowSeconds: 150,
        resolveGrantSenderKeys: resolver,
      }),
    ).rejects.toBeInstanceOf(AncV1JobEnvelopeError);
    expect(resolver).toHaveBeenCalledOnce();

    await expect(
      openAncV1JobEnvelope({
        encoded,
        expectedVaultId: f.vaultId,
        expectedJobId: f.jobId,
        expectedRecipientEndpointId: f.brokerId,
        recipientKeyAgreementPrivateKey: p(0xee, 32),
        nowSeconds: 150,
        resolveGrantSenderKeys: resolver,
      }),
    ).rejects.toBeInstanceOf(AncV1JobEnvelopeError);
  });

  it("rejects unknown fields and unknown grants", async () => {
    const f = await fixture();
    const encoded = await sealAncV1JobEnvelope({
      vaultId: f.vaultId,
      envelopeId: p(0x31, 16),
      createdAt: 100,
      jobId: f.jobId,
      grantRef: f.grantRef,
      issuedAt: 100,
      expiresAt: 200,
      recipientEndpointId: f.brokerId,
      plaintext: new Uint8Array(),
      nonce: p(0x32, 24),
      senderKeyAgreementPrivateKey: f.requesterBox.privateKey,
      recipientKeyAgreementPublicKey: f.brokerBox.publicKey,
      signingPrivateKey: f.authorizer.privateKey,
    });
    const unknown = map(encoded);
    unknown.set(999, "surprise");
    const base = {
      expectedVaultId: f.vaultId,
      expectedJobId: f.jobId,
      expectedRecipientEndpointId: f.brokerId,
      recipientKeyAgreementPrivateKey: f.brokerBox.privateKey,
      nowSeconds: 150,
    };

    await expect(
      openAncV1JobEnvelope({
        ...base,
        encoded: encodeAncV1Canonical(unknown),
        resolveGrantSenderKeys: () => ({
          signingPublicKey: f.authorizer.publicKey,
          keyAgreementPublicKey: f.requesterBox.publicKey,
        }),
      }),
    ).rejects.toBeInstanceOf(AncV1JobEnvelopeError);
    await expect(
      openAncV1JobEnvelope({
        ...base,
        encoded,
        resolveGrantSenderKeys: () => null,
      }),
    ).rejects.toBeInstanceOf(AncV1JobEnvelopeError);
  });
});

describe("anc/v1 encrypted result envelopes", () => {
  it("authenticates terminal state with result coordinates and plaintext", async () => {
    const f = await fixture();
    const jobHash = p(0x41, 32);
    const encoded = await sealAncV1ResultEnvelope({
      vaultId: f.vaultId,
      envelopeId: p(0x42, 16),
      createdAt: 201,
      jobId: f.jobId,
      jobHash,
      recipientEndpointId: f.requesterId,
      state: "completed",
      plaintext: text("private result"),
      nonce: p(0x43, 24),
      senderKeyAgreementPrivateKey: f.brokerBox.privateKey,
      recipientKeyAgreementPublicKey: f.requesterBox.publicKey,
      signingPrivateKey: f.broker.privateKey,
    });

    expect(parseAncV1ResultEnvelopeCoordinates(encoded)).toEqual({
      vaultId: f.vaultId,
      jobId: f.jobId,
      jobHash,
      recipientEndpointId: f.requesterId,
      state: "completed",
    });
    await expect(
      openAncV1ResultEnvelope({
        encoded,
        expectedVaultId: f.vaultId,
        expectedJobId: f.jobId,
        expectedJobHash: jobHash,
        expectedRecipientEndpointId: f.requesterId,
        recipientKeyAgreementPrivateKey: f.requesterBox.privateKey,
        brokerSigningPublicKey: f.broker.publicKey,
        brokerKeyAgreementPublicKey: f.brokerBox.publicKey,
      }),
    ).resolves.toEqual({
      plaintext: text("private result"),
      state: "completed",
    });

    const flippedState = map(encoded);
    flippedState.set(E2EE_ENVELOPE_FIELDS.result.state, "failed");
    await expect(
      openAncV1ResultEnvelope({
        encoded: encodeAncV1Canonical(flippedState),
        expectedVaultId: f.vaultId,
        expectedJobId: f.jobId,
        expectedJobHash: jobHash,
        expectedRecipientEndpointId: f.requesterId,
        recipientKeyAgreementPrivateKey: f.requesterBox.privateKey,
        brokerSigningPublicKey: f.broker.publicKey,
        brokerKeyAgreementPublicKey: f.brokerBox.publicKey,
      }),
    ).rejects.toBeInstanceOf(AncV1JobEnvelopeError);
    await expect(
      sealAncV1ResultEnvelope({
        vaultId: f.vaultId,
        envelopeId: p(0x42, 16),
        createdAt: 201,
        jobId: f.jobId,
        jobHash,
        recipientEndpointId: f.requesterId,
        state: "cancelled" as "completed",
        plaintext: text("must not seal"),
        nonce: p(0x43, 24),
        senderKeyAgreementPrivateKey: f.brokerBox.privateKey,
        recipientKeyAgreementPublicKey: f.requesterBox.publicKey,
        signingPrivateKey: f.broker.privateKey,
      }),
    ).rejects.toBeInstanceOf(AncV1JobEnvelopeError);
  });

  it("rejects a result for the wrong request hash, recipient, or signer", async () => {
    const f = await fixture();
    const jobHash = p(0x41, 32);
    const encoded = await sealAncV1ResultEnvelope({
      vaultId: f.vaultId,
      envelopeId: p(0x42, 16),
      createdAt: 201,
      jobId: f.jobId,
      jobHash,
      recipientEndpointId: f.requesterId,
      state: "failed",
      plaintext: new Uint8Array(),
      nonce: p(0x43, 24),
      senderKeyAgreementPrivateKey: f.brokerBox.privateKey,
      recipientKeyAgreementPublicKey: f.requesterBox.publicKey,
      signingPrivateKey: f.broker.privateKey,
    });
    const base = {
      encoded,
      expectedVaultId: f.vaultId,
      expectedJobId: f.jobId,
      expectedRecipientEndpointId: f.requesterId,
      recipientKeyAgreementPrivateKey: f.requesterBox.privateKey,
      brokerSigningPublicKey: f.broker.publicKey,
      brokerKeyAgreementPublicKey: f.brokerBox.publicKey,
    };

    await expect(
      openAncV1ResultEnvelope({
        ...base,
        expectedJobHash: p(0xff, 32),
      }),
    ).rejects.toBeInstanceOf(AncV1JobEnvelopeError);
    await expect(
      openAncV1ResultEnvelope({
        ...base,
        expectedJobHash: jobHash,
        expectedRecipientEndpointId: p(0xff, 16),
      }),
    ).rejects.toBeInstanceOf(AncV1JobEnvelopeError);
    await expect(
      openAncV1ResultEnvelope({
        ...base,
        expectedJobHash: jobHash,
        brokerSigningPublicKey: f.authorizer.publicKey,
      }),
    ).rejects.toBeInstanceOf(AncV1JobEnvelopeError);
  });
});
