import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { closeDbExec, runMigrations } from "@agent-native/core/db";
import {
  ORG_MIGRATIONS,
  organizations,
  orgMembers,
} from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server";
import { deleteOrgSetting, putOrgSetting } from "@agent-native/core/settings";
import {
  ensureWorkspaceConnectionsTable,
  upsertWorkspaceConnection,
} from "@agent-native/core/workspace-connections";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDb } from "../db/index.js";
import {
  clearDataBrowserCatalog,
  readDataBrowserCatalog,
  refreshDataBrowserCatalog,
} from "./data-browser-catalog.js";
import {
  beginConnectionDeletionPhases,
  finishConnectionDeletionPhases,
} from "./data-connection-mutations.js";
import { requestMetadata } from "./data-connection-provider.js";
import { readConnectionDeletionState } from "./data-resource-metadata.js";
import { ensureAnalyticsDatabase } from "./database.js";

const round = mkdtempSync(join(tmpdir(), "data-catalog-"));
const previousDatabase = process.env.DATABASE_URL;
const orgId = `qa-catalog-${randomUUID()}`;
const owner = "catalog-owner@example.test";
const scope = { ownerEmail: owner, orgId };

function asActor<T>(call: () => T) {
  return runWithRequestContext(
    {
      userEmail: owner,
      orgId,
      authUserId: owner,
      userName: "QA test account",
      isSyntheticTraffic: true,
    },
    call,
  );
}

async function waitFor(condition: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (await condition()) return;
    await new Promise((done) => setTimeout(done, 10));
  }
  throw new Error("Timed out waiting for the catalog reservation");
}

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${join(round, "database")}`;
  await runMigrations([...ORG_MIGRATIONS] as never, {
    table: "qa_data_catalog_org_migrations",
  })(null);
  await ensureAnalyticsDatabase();
  await ensureWorkspaceConnectionsTable();
  // Core settings are created lazily by non-transactional helpers. The app
  // guard reads and writes inside a transaction, so warm the table first.
  await putOrgSetting(orgId, "qa.catalog.warmup", { ready: true });
  await deleteOrgSetting(orgId, "qa.catalog.warmup");
  await getDb().insert(organizations).values({
    id: orgId,
    name: "QA catalog workspace",
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
  if (previousDatabase === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabase;
  const owned = resolve(round);
  if (
    owned !== resolve(tmpdir()) &&
    owned !== resolve(process.cwd()) &&
    owned.startsWith(resolve(tmpdir()) + "/data-catalog-")
  ) {
    rmSync(owned, { recursive: true, force: true });
  } else {
    throw new Error("Refused cleanup outside this test round");
  }
});

function pages() {
  return [
    {
      items: [
        {
          id: "schema:qa:a",
          name: "a",
          kind: "schema" as const,
          hasChildren: true,
        },
        {
          id: "schema:qa:b",
          name: "b",
          kind: "schema" as const,
          hasChildren: true,
        },
      ],
      endCursor: "page-2",
      hasNextPage: true,
    },
    {
      items: [
        {
          id: "schema:qa:c",
          name: "c",
          kind: "schema" as const,
          hasChildren: true,
        },
      ],
      endCursor: null,
      hasNextPage: false,
    },
  ];
}

describe("catalog writes under the real connection guard", () => {
  it("keeps the last good schemas and exposes a safe BigQuery refusal", async () => {
    const connection = await asActor(() =>
      upsertWorkspaceConnection({
        provider: "bigquery",
        label: "QA catalog provider refusal",
      }),
    );
    const items = pages().flatMap((page) => page.items);
    await asActor(() =>
      refreshDataBrowserCatalog(connection.id, {
        caller: "frontend",
        listPage: async () => ({
          items,
          endCursor: null,
          hasNextPage: false,
        }),
      }),
    );
    const executeRequest = async () => ({
      response: {
        ok: false,
        status: 403,
        json: {
          error: {
            errors: [{ reason: "accessDenied" }],
            message: "Raw upstream text with private request details",
          },
        },
      },
    });
    const runtime = { executeRequest } as unknown as Parameters<
      typeof requestMetadata
    >[0];
    const detail = "BigQuery could not list datasets (HTTP 403, accessDenied).";
    await expect(
      asActor(() =>
        refreshDataBrowserCatalog(connection.id, {
          caller: "frontend",
          listPage: async () => {
            const page = await requestMetadata(runtime, "qa");
            return { items: page.items, endCursor: null, hasNextPage: false };
          },
        }),
      ),
    ).rejects.toMatchObject({
      errorCode: "data_catalog_refresh_failed",
      statusCode: 502,
      message: expect.stringContaining(detail),
    });
    const snapshot = await asActor(() =>
      readDataBrowserCatalog(
        { connectionId: connection.id, first: 10 },
        "frontend",
      ),
    );
    expect(snapshot.refreshError?.message).toContain(detail);
    expect(snapshot.refreshError?.message).not.toContain(
      "private request details",
    );
    expect(snapshot.resources.map((item) => item.name)).toEqual([
      "a",
      "b",
      "c",
    ]);
    await clearDataBrowserCatalog(scope, connection.id);
  });

  it("commits a catalog through the shared guard", async () => {
    const connection = await asActor(() =>
      upsertWorkspaceConnection({
        provider: "bigquery",
        label: "QA catalog connection",
      }),
    );
    const queue = pages();
    const result = await asActor(() =>
      refreshDataBrowserCatalog(connection.id, {
        caller: "frontend",
        listPage: async () => queue.shift()!,
      }),
    );
    expect(result.refreshState).toBe("ready");
    expect(result.totalCount).toBe(3);
    await clearDataBrowserCatalog(scope, connection.id);
  });

  it("blocks a late completion after a tombstone and removes only its own key", async () => {
    const connection = await asActor(() =>
      upsertWorkspaceConnection({
        provider: "bigquery",
        label: "QA catalog delete race",
      }),
    );
    const queue = pages();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    let call = 0;
    const refresh = asActor(() =>
      refreshDataBrowserCatalog(connection.id, {
        caller: "frontend",
        listPage: async () => {
          call += 1;
          if (call === 1) await gate;
          return queue.shift()!;
        },
      }),
    );
    await waitFor(
      async () =>
        (await readConnectionDeletionState(scope, connection.id)) === null &&
        call === 1,
    );
    await beginConnectionDeletionPhases(scope, connection.id);
    expect(await readConnectionDeletionState(scope, connection.id)).toBe(
      "deleting",
    );
    release?.();
    await expect(refresh).rejects.toThrow("changed or was removed");
    await finishConnectionDeletionPhases(scope, connection.id);
    expect(await readConnectionDeletionState(scope, connection.id)).toBe(
      "deleted",
    );
    await clearDataBrowserCatalog(scope, connection.id);
  }, 60_000);
});
