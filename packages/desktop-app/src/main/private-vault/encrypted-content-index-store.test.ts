import { mkdtemp, readFile, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type {
  PrivateVaultContentDocument,
  PrivateVaultContentManifest,
  PrivateVaultLocalManifestHead,
} from "./content-document-codec.js";
import {
  EncryptedContentIndexStore,
  EncryptedContentIndexStoreError,
} from "./encrypted-content-index-store.js";

const vaultId = "11".repeat(16);
const objectId = "22".repeat(16);
const revisionId = "33".repeat(32);
const directories: string[] = [];

function cipher() {
  return {
    available: () => true,
    seal: (value: Uint8Array) => Uint8Array.from(value, (byte) => byte ^ 0xa5),
    open: (value: Uint8Array) => Uint8Array.from(value, (byte) => byte ^ 0xa5),
  };
}

function document(): PrivateVaultContentDocument {
  return {
    version: 1,
    kind: "content-document",
    id: objectId,
    parentId: null,
    title: "Needle title",
    content: "Private haystack",
    description: null,
    icon: null,
    position: 0,
    isFavorite: false,
    hideFromSearch: false,
    createdAt: "2026-07-18T20:00:00.000Z",
    updatedAt: "2026-07-18T20:00:00.000Z",
  };
}

function manifest(): PrivateVaultContentManifest {
  return {
    version: 1,
    kind: "content-vault-manifest",
    vaultId,
    generation: 1,
    previousManifest: null,
    documents: [
      {
        objectId,
        revisions: [{ revision: 1, revisionId, parentRevisionIds: [] }],
      },
    ],
    committedAt: "2026-07-18T20:00:00.000Z",
  };
}

function manifestHead(): PrivateVaultLocalManifestHead {
  return { version: 1, objectId, revisionId, manifest: manifest() };
}

async function store() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "anc-content-index-"));
  directories.push(directory);
  const value = new EncryptedContentIndexStore({ directory, cipher: cipher() });
  await value.initialize();
  return { directory, store: value };
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("EncryptedContentIndexStore", () => {
  it("atomically stores an encrypted manifest and document cache", async () => {
    const fixture = await store();
    await fixture.store.writeManifest(manifestHead());
    await fixture.store.writeDocument(vaultId, revisionId, document());

    expect(await fixture.store.readManifest(vaultId)).toEqual(manifestHead());
    expect(
      await fixture.store.readDocument(vaultId, objectId, revisionId),
    ).toEqual(document());
    expect(await fixture.store.listDocumentIds(vaultId)).toEqual([objectId]);

    const raw = await readFile(
      path.join(fixture.directory, vaultId, `${objectId}--${revisionId}.enc`),
      "utf8",
    );
    expect(raw).not.toContain("Needle title");
    expect(raw).not.toContain("Private haystack");
  });

  it("deletes a cached document without deleting the manifest", async () => {
    const fixture = await store();
    await fixture.store.writeManifest(manifestHead());
    await fixture.store.writeDocument(vaultId, revisionId, document());
    await fixture.store.deleteDocument(vaultId, objectId);
    expect(
      await fixture.store.readDocument(vaultId, objectId, revisionId),
    ).toBeNull();
    expect(await fixture.store.readManifest(vaultId)).toEqual(manifestHead());
  });

  it("fails closed for unavailable encryption and use after close", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "anc-content-index-"),
    );
    directories.push(directory);
    const unavailable = new EncryptedContentIndexStore({
      directory,
      cipher: { ...cipher(), available: () => false },
    });
    await expect(unavailable.initialize()).rejects.toBeInstanceOf(
      EncryptedContentIndexStoreError,
    );

    const fixture = await store();
    fixture.store.close();
    await expect(fixture.store.readManifest(vaultId)).rejects.toBeInstanceOf(
      EncryptedContentIndexStoreError,
    );
  });

  it("rejects symlinked vault directories and unknown index files", async () => {
    const fixture = await store();
    const outside = await mkdtemp(
      path.join(os.tmpdir(), "anc-content-outside-"),
    );
    directories.push(outside);
    await symlink(outside, path.join(fixture.directory, vaultId));
    await expect(fixture.store.readManifest(vaultId)).rejects.toBeInstanceOf(
      EncryptedContentIndexStoreError,
    );

    const second = await store();
    await second.store.writeManifest(manifestHead());
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path.join(second.directory, vaultId, "surprise.txt"), "x");
    await expect(second.store.listDocumentIds(vaultId)).rejects.toBeInstanceOf(
      EncryptedContentIndexStoreError,
    );
  });
});
