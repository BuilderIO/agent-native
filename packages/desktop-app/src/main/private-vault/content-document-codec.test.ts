import { describe, expect, it } from "vitest";

import {
  decodePrivateVaultContentDocument,
  decodePrivateVaultContentManifest,
  encodePrivateVaultContentDocument,
  encodePrivateVaultContentManifest,
  privateVaultContentDocumentSchema,
  privateVaultContentManifestSchema,
} from "./content-document-codec";

const objectId = "11".repeat(16);
const revisionId = "22".repeat(32);

function documentFixture() {
  return {
    version: 1 as const,
    kind: "content-document" as const,
    id: objectId,
    parentId: null,
    title: "A private title",
    content: "A private body",
    description: null,
    icon: null,
    position: 0,
    isFavorite: false,
    hideFromSearch: false,
    createdAt: "2026-07-18T20:00:00.000Z",
    updatedAt: "2026-07-18T20:00:00.000Z",
  };
}

function manifestFixture() {
  return {
    version: 1 as const,
    kind: "content-vault-manifest" as const,
    vaultId: "33".repeat(16),
    generation: 1,
    previousManifest: null,
    documents: [
      {
        objectId,
        revisions: [
          { revision: 1, revisionId, parentRevisionIds: [] as string[] },
        ],
      },
    ],
    committedAt: "2026-07-18T20:00:00.000Z",
  };
}

describe("Private Vault Content plaintext codecs", () => {
  it("round-trips one canonical encrypted document payload", () => {
    const fixture = documentFixture();
    const encoded = encodePrivateVaultContentDocument(fixture);
    expect(decodePrivateVaultContentDocument(encoded)).toEqual(fixture);
    expect(new TextDecoder().decode(encoded)).toBe(JSON.stringify(fixture));
  });

  it("round-trips a manifest that keeps revision numbers encrypted", () => {
    const fixture = manifestFixture();
    expect(
      decodePrivateVaultContentManifest(
        encodePrivateVaultContentManifest(fixture),
      ),
    ).toEqual(fixture);
  });

  it("rejects noncanonical, unknown, and malformed document payloads", () => {
    const fixture = documentFixture();
    const spaced = new TextEncoder().encode(JSON.stringify(fixture, null, 2));
    const unknown = { ...fixture, leakedMetadata: "no" };
    expect(() => decodePrivateVaultContentDocument(spaced)).toThrow(
      "unavailable",
    );
    expect(privateVaultContentDocumentSchema.safeParse(unknown).success).toBe(
      false,
    );
    expect(() =>
      decodePrivateVaultContentDocument(new Uint8Array([0xff])),
    ).toThrow("unavailable");
  });

  it("rejects self-parenting and backwards document time", () => {
    expect(
      privateVaultContentDocumentSchema.safeParse({
        ...documentFixture(),
        parentId: objectId,
      }).success,
    ).toBe(false);
    expect(
      privateVaultContentDocumentSchema.safeParse({
        ...documentFixture(),
        updatedAt: "2026-07-18T19:59:59.000Z",
      }).success,
    ).toBe(false);
  });

  it("rejects manifest forks, duplicate objects, and broken ancestry", () => {
    const fixture = manifestFixture();
    expect(
      privateVaultContentManifestSchema.safeParse({
        ...fixture,
        documents: [...fixture.documents, fixture.documents[0]],
      }).success,
    ).toBe(false);
    expect(
      privateVaultContentManifestSchema.safeParse({
        ...fixture,
        documents: [
          {
            objectId,
            revisions: [
              { revision: 2, revisionId, parentRevisionIds: [] },
              {
                revision: 1,
                revisionId: "44".repeat(32),
                parentRevisionIds: [],
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      privateVaultContentManifestSchema.safeParse({
        ...fixture,
        generation: 2,
      }).success,
    ).toBe(false);
  });
});
