import { describe, expect, it, vi } from "vitest";

import {
  PRIVATE_VAULT_CONTENT_TYPE,
  type PrivateVaultContentDocument,
  type PrivateVaultLocalManifestHead,
} from "./content-document-codec.js";
import { PrivateVaultContentDocumentRuntime } from "./content-document-runtime.js";

const vaultId = "11".repeat(16);
const documentId = "22".repeat(16);
const TITLE = "Two-device sentinel title";
const FIRST_BODY = "First-device sentinel body";
const SECOND_BODY = "Second-device sentinel body";

interface HostedRecord {
  readonly vaultId: string;
  readonly objectId: string;
  readonly revisionId: string;
  readonly revision: number;
  readonly objectType: "document" | "vault-manifest";
  readonly epoch: number;
  readonly ciphertext: Uint8Array;
}

function encryptedRelay() {
  let nextRevision = 1;
  const records = new Map<string, HostedRecord>();
  const key = (objectId: string, revisionId: string) =>
    `${objectId}:${revisionId}`;
  const crypt = (bytes: Uint8Array) =>
    Uint8Array.from(bytes, (byte) => byte ^ 0xa5);
  const transport = {
    list: vi.fn(async (requestedVaultId: string) => {
      const latest = new Map<string, HostedRecord>();
      for (const record of records.values()) {
        if (record.vaultId !== requestedVaultId) continue;
        const current = latest.get(record.objectId);
        if (!current || current.revision < record.revision)
          latest.set(record.objectId, record);
      }
      return [...latest.values()].map((record) => ({
        objectId: record.objectId,
        objectType: record.objectType,
        latestRevision: {
          revision: record.revision,
          revisionId: record.revisionId,
        },
      }));
    }),
  };
  const objects = {
    sealAndUpload: vi.fn(
      async (input: {
        vaultId: string;
        objectId: string;
        revision: number;
        contentType: string;
        plaintext: Uint8Array;
      }) => {
        const revisionId = nextRevision.toString(16).padStart(64, "0");
        nextRevision += 1;
        const ciphertext = crypt(input.plaintext);
        records.set(
          key(input.objectId, revisionId),
          Object.freeze({
            vaultId: input.vaultId,
            objectId: input.objectId,
            revisionId,
            revision: input.revision,
            objectType:
              input.contentType === PRIVATE_VAULT_CONTENT_TYPE
                ? "document"
                : "vault-manifest",
            epoch: 1,
            ciphertext,
          }),
        );
        return {
          revisionId,
          epoch: 1,
          plaintextLength: input.plaintext.byteLength,
          ciphertextByteLength: ciphertext.byteLength,
        };
      },
    ),
    downloadAndOpen: vi.fn(
      async (input: { objectId: string; revisionId: string }) => {
        const record = records.get(key(input.objectId, input.revisionId));
        if (!record) throw new Error("opaque object unavailable");
        const plaintext = crypt(record.ciphertext);
        return {
          plaintext,
          epoch: record.epoch,
          writerEndpointId: "33".repeat(16),
          metadata: {
            revision: record.revision,
            objectType: record.objectType,
            algorithmId: "anc/v1",
            epoch: record.epoch,
            parentRevisionIds: [],
            ciphertextByteLength: record.ciphertext.byteLength,
          },
        };
      },
    ),
  };
  return { records, transport, objects };
}

function localDevice() {
  let head: PrivateVaultLocalManifestHead | null = null;
  const documents = new Map<string, PrivateVaultContentDocument>();
  return {
    initialize: vi.fn(async () => undefined),
    close: vi.fn(),
    readManifest: vi.fn(async () => head),
    writeManifest: vi.fn(async (value: PrivateVaultLocalManifestHead) => {
      head = value;
    }),
    readDocument: vi.fn(
      async (_vaultId: string, objectId: string, revisionId: string) =>
        documents.get(`${objectId}:${revisionId}`) ?? null,
    ),
    writeDocument: vi.fn(
      async (
        _vaultId: string,
        revisionId: string,
        document: PrivateVaultContentDocument,
      ) => {
        documents.set(`${document.id}:${revisionId}`, document);
      },
    ),
    deleteDocument: vi.fn(async () => undefined),
  };
}

function runtime(
  relay: ReturnType<typeof encryptedRelay>,
  index: ReturnType<typeof localDevice>,
) {
  return new PrivateVaultContentDocumentRuntime({
    index: index as never,
    transport: relay.transport as never,
    objects: relay.objects as never,
  });
}

describe("Private Content two-device encrypted synchronization", () => {
  it("synchronizes edits without putting titles or bodies in the hosted relay", async () => {
    const relay = encryptedRelay();
    const first = runtime(relay, localDevice());
    const second = runtime(relay, localDevice());

    await first.initialize(vaultId);
    await first.createDocument(vaultId, {
      id: documentId,
      title: TITLE,
      content: FIRST_BODY,
    });

    await second.initialize(vaultId);
    await expect(
      second.getDocument(vaultId, documentId),
    ).resolves.toMatchObject({ title: TITLE, content: FIRST_BODY });
    await second.updateDocument(vaultId, documentId, { content: SECOND_BODY });

    await first.synchronize(vaultId);
    await expect(first.getDocument(vaultId, documentId)).resolves.toMatchObject(
      {
        title: TITLE,
        content: SECOND_BODY,
      },
    );

    const hostedDump = JSON.stringify(
      [...relay.records.values()].map((record) => ({
        ...record,
        ciphertext: Buffer.from(record.ciphertext).toString("base64"),
      })),
    );
    expect(hostedDump).not.toContain(TITLE);
    expect(hostedDump).not.toContain(FIRST_BODY);
    expect(hostedDump).not.toContain(SECOND_BODY);
    expect(relay.records.size).toBe(4);
  });
});
