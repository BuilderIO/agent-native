import { describe, expect, it } from "vitest";

import {
  E2EE_CANONICAL_ENCODING,
  E2EE_DOMAIN_TAGS,
  E2EE_ENVELOPE_FIELDS,
  E2EE_LIFETIME_LIMITS_SECONDS,
  E2EE_PRIMITIVES,
  E2EE_SIZE_LIMITS,
  E2EE_SUITE_ID,
  e2eeDomainSeparationPrefix,
} from "./suite.js";

describe("anc/v1 suite freeze", () => {
  it("pins one non-negotiated suite and standard primitive set", () => {
    expect(E2EE_SUITE_ID).toBe("anc/v1");
    expect(E2EE_CANONICAL_ENCODING).toBe("cbor-rfc8949-deterministic");
    expect(E2EE_PRIMITIVES).toEqual({
      contentAead: "xchacha20-poly1305-ietf",
      streamAead: "secretstream-xchacha20-poly1305",
      signatures: "ed25519",
      endpointKeyAgreement: "x25519-xsalsa20-poly1305",
      hash: "blake2b-256",
      passwordHash: "argon2id",
    });
  });

  it("freezes domain separation and integer field tables", () => {
    expect(E2EE_DOMAIN_TAGS).toContain("disclosure");
    expect(E2EE_DOMAIN_TAGS).toContain("manifest");
    expect(E2EE_DOMAIN_TAGS).toContain("endpoint-request-body");
    expect(E2EE_DOMAIN_TAGS).toContain("endpoint-request");
    expect(E2EE_ENVELOPE_FIELDS.common).toEqual({
      suite: 1,
      vaultId: 2,
      type: 3,
      createdAt: 4,
      envelopeId: 5,
    });
    expect("title" in E2EE_ENVELOPE_FIELDS.objectHeader).toBe(false);
    expect(Array.from(e2eeDomainSeparationPrefix("job"))).toEqual(
      Array.from(new TextEncoder().encode("anc/v1/job\0")),
    );
  });

  it("pins bounded payload and authorization lifetimes", () => {
    expect(E2EE_SIZE_LIMITS.chunkPlaintextBytes).toBe(1024 * 1024);
    expect(E2EE_SIZE_LIMITS.objectPlaintextBytes).toBe(256 * 1024 * 1024);
    expect(E2EE_LIFETIME_LIMITS_SECONDS).toEqual({
      internalGrantMaximum: 2_592_000,
      disclosureDefault: 86_400,
      disclosureMaximum: 604_800,
      brokerAuthorizationFreshness: 900,
    });
  });
});
