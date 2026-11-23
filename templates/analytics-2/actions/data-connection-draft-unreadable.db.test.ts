import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { deleteCredential } from "@agent-native/core/credentials";
import { closeDbExec, runMigrations } from "@agent-native/core/db";
import {
  ORG_MIGRATIONS,
  organizations,
  orgMembers,
} from "@agent-native/core/org";
import { encryptSecretValue } from "@agent-native/core/secrets";
import { runWithRequestContext } from "@agent-native/core/server";
import { putSetting } from "@agent-native/core/settings";
import {
  ensureWorkspaceConnectionsTable,
  getWorkspaceConnection,
} from "@agent-native/core/workspace-connections";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

const providerCalls = vi.hoisted(() => ({
  serviceAccountValidations: 0,
  metadataRequests: 0,
}));

vi.mock(
  "../server/model/data-connection-provider.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../server/model/data-connection-provider.js")
    >()),
    validateSubmittedServiceAccount: async () => {
      providerCalls.serviceAccountValidations += 1;
    },
    validateBigQueryProjectAccess: async () => {
      providerCalls.metadataRequests += 1;
    },
    requestMetadata: async () => {
      providerCalls.metadataRequests += 1;
      return { items: [] };
    },
  }),
);

import { getDb } from "../server/db/index.js";
import {
  deleteDataConnection,
  saveDataConnection,
} from "../server/model/data-connections.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";

const round = mkdtempSync(join(tmpdir(), "data-team-draft-unreadable-"));
const orgId = `qa-draft-unreadable-${randomUUID()}`;
const owner = "draft-unreadable-owner@example.test";
const credentialPlaintext = "flagged-source-credential";
const previousDatabase = process.env.DATABASE_URL;
const previousAuthSecret = process.env.BETTER_AUTH_SECRET;

const asOwner = <T>(call: () => T) =>
  runWithRequestContext(
    { userEmail: owner, orgId, authUserId: owner, isSyntheticTraffic: true },
    call,
  );

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${join(round, "database")}`;
  process.env.BETTER_AUTH_SECRET = randomBytes(48).toString("base64url");
  await runMigrations([...ORG_MIGRATIONS], {
    table: "qa_draft_unreadable_org_migrations",
  })(null);
  await ensureAnalyticsDatabase();
  await ensureWorkspaceConnectionsTable();
  await getDb().insert(organizations).values({
    id: orgId,
    name: "QA draft unreadable local workspace",
    createdBy: owner,
    createdAt: Date.now(),
  });
  await getDb().insert(orgMembers).values({
    id: randomUUID(),
    orgId,
    email: owner,
    role: "owner",
    joinedAt: Date.now(),
  });
});

afterAll(async () => {
  await closeDbExec();
  if (
    !resolve(round).startsWith(
      resolve(tmpdir()) + "/data-team-draft-unreadable-",
    )
  )
    throw new Error("Refused own runtime cleanup");
  rmSync(round, { recursive: true });
  if (previousDatabase === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabase;
  if (previousAuthSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
  else process.env.BETTER_AUTH_SECRET = previousAuthSecret;
});

/**
 * Save a draft through the real vault, then replace its legacy SQL credential
 * setting with a real `v1:` ciphertext of the short marker plaintext whose
 * authentication tag has been tampered with. The value still matches the
 * encrypted-row shape the vault recognizes, so the only reason it cannot be
 * read is the corruption itself — no fake long key material, no mocked crypto.
 */
async function saveDraftWithCorruptVaultRow(): Promise<string> {
  const saved = await asOwner(() =>
    saveDataConnection({
      requestId: randomUUID(),
      type: "bigquery",
      draft: true,
      values: {
        name: "QA draft unreadable credential",
        projectId: "qa-project",
        serviceAccount: credentialPlaintext,
      },
    }),
  );
  const connection = await asOwner(() => getWorkspaceConnection(saved.id));
  const key = connection?.config.serviceAccountCredentialKey;
  if (typeof key !== "string" || !key)
    throw new Error("Missing saved draft credential reference");
  const encrypted = encryptSecretValue(credentialPlaintext);
  const parts = encrypted.split(":");
  const tag = parts[3];
  if (!tag) throw new Error("Missing encrypted fixture tag");
  parts[3] = tag.slice(0, -1) + (tag.endsWith("0") ? "1" : "0");
  const corrupt = parts.join(":");
  if (!/^v1:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/.test(corrupt))
    throw new Error("Corrupt fixture must keep the encrypted-row shape");
  await putSetting(`o:${orgId}:credential:${key}`, { value: corrupt });
  return saved.id;
}

async function activateDraft(id: string) {
  return asOwner(() =>
    saveDataConnection({
      requestId: randomUUID(),
      id,
      type: "bigquery",
      draft: false,
      values: { name: "QA activate draft unreadable credential" },
    }),
  );
}

it("returns 503 before any provider request when a saved draft credential row is unreadable", async () => {
  providerCalls.serviceAccountValidations = 0;
  providerCalls.metadataRequests = 0;
  const id = await saveDraftWithCorruptVaultRow();
  try {
    let error: unknown;
    try {
      await activateDraft(id);
    } catch (cause) {
      error = cause;
    }
    expect(error).toMatchObject({
      statusCode: 503,
      errorCode: "data_connection_draft_credentials_unreadable",
    });
    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain(credentialPlaintext);
    expect(serialized).not.toContain("v1:");
    expect(providerCalls).toEqual({
      serviceAccountValidations: 0,
      metadataRequests: 0,
    });
    expect((await asOwner(() => getWorkspaceConnection(id)))?.status).toBe(
      "disabled",
    );
  } finally {
    await asOwner(() => deleteDataConnection({ id }));
  }
});

it("keeps the distinct 409 for a missing saved draft credential row", async () => {
  providerCalls.serviceAccountValidations = 0;
  providerCalls.metadataRequests = 0;
  const saved = await asOwner(() =>
    saveDataConnection({
      requestId: randomUUID(),
      type: "bigquery",
      draft: true,
      values: {
        name: "QA draft missing credential",
        projectId: "qa-project",
        serviceAccount: credentialPlaintext,
      },
    }),
  );
  const connection = await asOwner(() => getWorkspaceConnection(saved.id));
  const key = connection?.config.serviceAccountCredentialKey;
  if (typeof key !== "string" || !key)
    throw new Error("Missing saved draft credential reference");
  await asOwner(() =>
    deleteCredential(key, { userEmail: owner, orgId, scope: "org" }),
  );
  try {
    await expect(activateDraft(saved.id)).rejects.toMatchObject({
      statusCode: 409,
      errorCode: "data_connection_draft_credentials_missing",
    });
    expect(providerCalls).toEqual({
      serviceAccountValidations: 0,
      metadataRequests: 0,
    });
  } finally {
    await asOwner(() => deleteDataConnection({ id: saved.id }));
  }
});
