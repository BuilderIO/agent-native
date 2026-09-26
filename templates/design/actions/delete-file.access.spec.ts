import { orgMembers as distOrgMembers } from "@agent-native/core/org";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { registerFeatureFlags } from "../../../packages/core/src/feature-flags/registry.js";
import { CROSS_APP_ORG_FEDERATION_FLAG } from "../../../packages/core/src/org/feature-flags.js";
import { orgMembers as sourceOrgMembers } from "../../../packages/core/src/org/schema.js";
import { runWithRequestContext } from "../../../packages/core/src/server/request-context.js";
import { registerShareableResource } from "../../../packages/core/src/sharing/registry.js";
import * as schema from "../server/db/schema.js";

const mocks = vi.hoisted(() => ({
  db: undefined as any,
  executedStatements: [] as unknown[],
  linkedOrganization: false,
}));

vi.mock("../server/db/index.js", async () => {
  return {
    getDb: () => mocks.db,
    schema,
  };
});

vi.mock(
  "@agent-native/core/sharing",
  async () => import("../../../packages/core/src/sharing/index.ts"),
);

vi.mock("../server/lib/design-versions.js", () => ({
  snapshotDesignBeforeAgentEditInVersionLock: vi.fn(),
  withDesignVersionLock: async (
    _designId: string,
    callback: () => Promise<unknown>,
  ) => callback(),
}));

vi.mock("../server/source-workspace.js", () => ({
  affectedRowCount: (result: { rowCount?: number }) => result.rowCount,
  designSourceMutationLockKey: (designId: string) =>
    `agent-native:design-source:${designId}`,
  lockDesignFilesTable: vi.fn(),
  lockDesignSourceMutation: vi.fn(),
}));

import action from "./delete-file.js";

const designId = "design_shared_without_org_members";
const file = {
  id: "file-to-delete",
  designId,
  filename: "screen.html",
  fileType: "html",
  content: "<main>Delete me</main>",
};
const otherFile = {
  id: "file-to-keep",
  designId,
  filename: "keep.html",
  fileType: "html",
  content: "<main>Keep me</main>",
};
const designData = JSON.stringify({
  canvasFrames: { [file.id]: { x: 0, y: 0, width: 300, height: 600, z: 0 } },
});
const design = {
  id: designId,
  data: designData,
  updatedAt: "2026-09-20T00:00:00.000Z",
  ownerEmail: "owner@example.com",
  orgId: "org-1",
  visibility: "org" as const,
};

function makeChain(transaction: boolean) {
  let table: unknown;
  const chain: any = {
    from(nextTable: unknown) {
      table = nextTable;
      return chain;
    },
    innerJoin() {
      return chain;
    },
    where() {
      return chain;
    },
    limit() {
      return chain;
    },
    for() {
      return chain;
    },
    then(
      resolve: (value: unknown) => unknown,
      reject: (error: unknown) => unknown,
    ) {
      return Promise.resolve()
        .then(() => {
          if (table === distOrgMembers || table === sourceOrgMembers) {
            if (mocks.linkedOrganization) return [{ id: "member-1" }];
            throw new Error('relation "org_members" does not exist');
          }
          if (table === schema.designFiles) {
            return transaction ? [file, otherFile] : [file];
          }
          if (table === schema.designs) return [design];
          if (table === schema.designShares) {
            return transaction ? [] : [{ role: "editor" }];
          }
          return [];
        })
        .then(resolve, reject);
    },
  };
  return chain;
}

function makeDatabase() {
  const tx = {
    select: vi.fn(() => makeChain(true)),
    execute: vi.fn(async (statement: unknown) => {
      mocks.executedStatements.push(statement);
      const normalizedSql = new PgDialect()
        .sqlToQuery(statement as any)
        .sql.replaceAll('"', "")
        .toLowerCase();

      if (normalizedSql.includes("org_members")) {
        if (!mocks.linkedOrganization) {
          throw new Error('relation "org_members" does not exist');
        }
        return { rows: [{ id: "member-1" }], rowsAffected: 1 };
      }
      if (normalizedSql.includes("organizations")) {
        return {
          rows: [{ identity_authority: "dispatch", identity_id: null }],
          rowsAffected: 1,
        };
      }
      if (normalizedSql.includes("public.settings")) {
        return { rows: [], rowsAffected: 0 };
      }
      if (normalizedSql.includes("designs")) {
        return {
          rows: [
            {
              id: designId,
              title: "Shared design",
              description: null,
              data: designData,
              data_operation_revisions: "{}",
              live_collaboration_enabled: false,
              project_type: "prototype",
              design_system_id: null,
              created_at: "2026-09-19T00:00:00.000Z",
              updated_at: design.updatedAt,
              owner_email: design.ownerEmail,
              org_id: design.orgId,
              visibility: design.visibility,
            },
          ],
          rowsAffected: 1,
        };
      }
      if (normalizedSql.includes("design_shares")) {
        return { rows: [{ role: "editor" }], rowsAffected: 1 };
      }
      return { rows: [], rowsAffected: 0 };
    }),
    delete: vi.fn(() => ({
      where: vi.fn(async () => ({ rowCount: 1 })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => ({ rowCount: 1 })),
      })),
    })),
  };
  return {
    select: vi.fn(() => makeChain(false)),
    transaction: vi.fn(async (callback: (value: typeof tx) => unknown) =>
      callback(tx),
    ),
    tx,
  };
}

describe("delete-file transactional access compatibility", () => {
  beforeEach(() => {
    mocks.executedStatements = [];
    mocks.linkedOrganization = false;
    mocks.db = makeDatabase();
    registerFeatureFlags([CROSS_APP_ORG_FEDERATION_FLAG]);
    registerShareableResource({
      type: "design",
      resourceTable: schema.designs,
      sharesTable: schema.designShares,
      displayName: "Design",
      getDb: () => mocks.db,
      ownerAccessIgnoresOrg: true,
    });
  });

  it("deletes a directly shared org-visible screen without org_members", async () => {
    await expect(
      runWithRequestContext(
        { userEmail: "shared@example.com", orgId: "org-1" },
        () => action.run({ id: file.id, allowLockedLayers: true }),
      ),
    ).resolves.toMatchObject({
      id: file.id,
      deleted: true,
    });
    expect(mocks.db.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.db.tx.delete).toHaveBeenCalledTimes(1);
    expect(mocks.db.tx.execute).toHaveBeenCalled();
  });

  it("translates feature-flag settings placeholders inside the transaction", async () => {
    mocks.linkedOrganization = true;
    mocks.db = makeDatabase();

    await expect(
      runWithRequestContext(
        { userEmail: "shared@example.com", orgId: "org-1" },
        () => action.run({ id: file.id, allowLockedLayers: true }),
      ),
    ).resolves.toMatchObject({ deleted: true });

    const settingsQueries = mocks.executedStatements
      .map((statement) => {
        try {
          return new PgDialect().sqlToQuery(statement as any);
        } catch {
          return null;
        }
      })
      .filter((query) =>
        query?.sql.replaceAll('"', "").includes("public.settings"),
      );
    expect(settingsQueries).toHaveLength(2);
    expect(settingsQueries.every((query) => !query?.sql.includes("?"))).toBe(
      true,
    );
    expect(settingsQueries.map((query) => query?.params)).toEqual(
      expect.arrayContaining([
        ["o:org-1:feature-flag:organization.cross-app-federation"],
        ["feature-flag:organization.cross-app-federation"],
      ]),
    );
  });
});
