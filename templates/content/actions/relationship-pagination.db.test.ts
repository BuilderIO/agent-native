import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const databasePath = join(
  tmpdir(),
  `relationship-pagination-${process.pid}-${Date.now()}.pglite`,
);
const owner = "relationship-pagination-owner@example.test";
const viewer = "relationship-pagination-viewer@example.test";
const prefix = `relationship-pagination-${process.pid}-${Date.now()}`;
const spaceId = `${prefix}-space`;
const sourceDatabaseId = `${prefix}-deliverables`;
const targetDatabaseId = `${prefix}-people`;
const sourceDatabasePageId = `${sourceDatabaseId}-page`;
const targetDatabasePageId = `${targetDatabaseId}-page`;
const anchorPageId = `${prefix}-launch`;

let dbModule: typeof import("../server/db/index.js");
let listCandidates: typeof import("./list-content-relation-candidates.js").default;
let listHistory: typeof import("./list-content-relationship-history.js").default;
let propertyId: string;
let relationshipTypeId: string;
let relationshipTypeVersionId: string;
let configuredRevisionId: string;

const candidateDocuments = [
  { id: `${prefix}-alpha`, title: "Alpha hidden", visible: false },
  { id: `${prefix}-bravo`, title: "Bravo visible", visible: true },
  { id: `${prefix}-charlie`, title: "Charlie hidden", visible: false },
  { id: `${prefix}-delta`, title: "Delta visible", visible: true },
  { id: `${prefix}-echo`, title: "Echo hidden", visible: false },
  { id: `${prefix}-foxtrot`, title: "Foxtrot visible", visible: true },
  { id: `${prefix}-ipek`, title: "İpek visible", visible: true },
];

const asUser = <T>(userEmail: string, run: () => Promise<T>) =>
  runWithRequestContext({ userEmail }, run);

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${databasePath}`;
  dbModule = await import("../server/db/index.js");
  await (await import("../server/plugins/db.js")).default(undefined as never);
  const configure = (await import("./configure-content-relation-property.js"))
    .default;
  listCandidates = (await import("./list-content-relation-candidates.js"))
    .default;
  listHistory = (await import("./list-content-relationship-history.js"))
    .default;

  const filesDatabaseId = `${prefix}-files`;
  await dbModule.getDb().insert(dbModule.schema.contentSpaces).values({
    id: spaceId,
    name: "Relationship pagination",
    kind: "personal",
    ownerEmail: owner,
    filesDatabaseId,
    createdBy: owner,
  });
  await dbModule
    .getDb()
    .insert(dbModule.schema.documents)
    .values([
      {
        id: `${filesDatabaseId}-page`,
        spaceId,
        ownerEmail: owner,
        title: "Files",
      },
      {
        id: sourceDatabasePageId,
        spaceId,
        ownerEmail: owner,
        title: "Campaign deliverables",
      },
      {
        id: targetDatabasePageId,
        spaceId,
        ownerEmail: owner,
        title: "Marketing team",
      },
      {
        id: anchorPageId,
        spaceId,
        ownerEmail: owner,
        title: "Launch article",
      },
      ...candidateDocuments.map((candidate) => ({
        id: candidate.id,
        spaceId,
        ownerEmail: owner,
        title: candidate.title,
      })),
    ]);
  await dbModule
    .getDb()
    .insert(dbModule.schema.contentDatabases)
    .values([
      {
        id: filesDatabaseId,
        documentId: `${filesDatabaseId}-page`,
        spaceId,
        ownerEmail: owner,
        title: "Files",
        systemRole: "files",
        blocksSeeded: 1,
      },
      {
        id: sourceDatabaseId,
        documentId: sourceDatabasePageId,
        spaceId,
        ownerEmail: owner,
        title: "Deliverables",
        blocksSeeded: 1,
      },
      {
        id: targetDatabaseId,
        documentId: targetDatabasePageId,
        spaceId,
        ownerEmail: owner,
        title: "People",
        blocksSeeded: 1,
      },
    ]);
  await dbModule
    .getDb()
    .insert(dbModule.schema.contentDatabaseItems)
    .values([
      {
        id: `${prefix}-anchor-item`,
        databaseId: sourceDatabaseId,
        documentId: anchorPageId,
        ownerEmail: owner,
      },
      ...candidateDocuments.map((candidate, index) => ({
        id: `${prefix}-candidate-item-${index}`,
        databaseId: targetDatabaseId,
        documentId: candidate.id,
        ownerEmail: owner,
        position: index,
      })),
    ]);
  const configured = await asUser(owner, () =>
    configure.run({
      ownerDatabaseId: sourceDatabaseId,
      alias: "Contributors",
      operationId: `${prefix}-configure`,
      definition: {
        kind: "new-local",
        forwardLabel: "Contributes to",
        inverseLabel: "Deliverables",
        forwardCardinality: "many",
        sourceDatabaseId,
        targetDatabaseId,
      },
    }),
  );
  propertyId = configured.projection.propertyId;
  relationshipTypeId = configured.relationshipType.id;
  relationshipTypeVersionId = configured.relationshipTypeVersion.id;
  configuredRevisionId = configured.revisionId;

  const sharedDocumentIds = [
    sourceDatabasePageId,
    targetDatabasePageId,
    anchorPageId,
    ...candidateDocuments
      .filter((candidate) => candidate.visible)
      .map((candidate) => candidate.id),
  ];
  await dbModule
    .getDb()
    .insert(dbModule.schema.documentShares)
    .values(
      sharedDocumentIds.map((resourceId, index) => ({
        id: `${prefix}-viewer-share-${index}`,
        resourceId,
        principalType: "user",
        principalId: viewer,
        role: "viewer",
        createdBy: owner,
      })),
    );
});

afterAll(() => {
  delete process.env.DATABASE_URL;
  rmSync(databasePath, { recursive: true, force: true });
});

describe("relationship read pagination", () => {
  it("paginates the authorized candidate set without counting hidden members", async () => {
    const first = await asUser(viewer, () =>
      listCandidates.run({
        propertyId,
        anchorPageId,
        search: "",
        contextPropertyIds: [],
        limit: 2,
      }),
    );
    expect(first.items.map((candidate) => candidate.title)).toEqual([
      "Bravo visible",
      "Delta visible",
    ]);
    expect(first.nextCursor).toBeTruthy();

    const second = await asUser(viewer, () =>
      listCandidates.run({
        propertyId,
        anchorPageId,
        search: "",
        contextPropertyIds: [],
        limit: 2,
        cursor: first.nextCursor!,
      }),
    );
    expect(second.items.map((candidate) => candidate.title)).toEqual([
      "Foxtrot visible",
      "İpek visible",
    ]);
    expect(second.nextCursor).toBeNull();
  });

  it("filters the authorized set in SQL before applying the page limit", async () => {
    const result = await asUser(viewer, () =>
      listCandidates.run({
        propertyId,
        anchorPageId,
        search: "delta",
        contextPropertyIds: [],
        limit: 1,
      }),
    );
    expect(result.items.map((candidate) => candidate.title)).toEqual([
      "Delta visible",
    ]);
    expect(result.nextCursor).toBeNull();
  });

  it("uses the database case mapping for both sides of non-ASCII search", async () => {
    const result = await asUser(viewer, () =>
      listCandidates.run({
        propertyId,
        anchorPageId,
        search: "İPEK",
        contextPropertyIds: [],
        limit: 1,
      }),
    );
    expect(result.items.map((candidate) => candidate.title)).toEqual([
      "İpek visible",
    ]);
  });

  it("preserves owner, public, organization, literal-search, order, and deletion semantics", async () => {
    const { organizations, orgMembers } =
      await import("@agent-native/core/org");
    await (dbModule.getDb() as any).$client.exec(`
      CREATE TABLE organizations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        allowed_domain TEXT,
        a2a_secret TEXT,
        workspace_url TEXT,
        required_auth_provider TEXT,
        identity_authority TEXT,
        identity_id TEXT,
        federation_roster_initialized_at BIGINT
      );
      CREATE TABLE org_members (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        email TEXT NOT NULL,
        role TEXT NOT NULL,
        joined_at BIGINT NOT NULL,
        federation_removal_pending_at BIGINT
      )
    `);
    const viewerOrgId = `${prefix}-viewer-org`;
    const otherOrgId = `${prefix}-other-org`;
    await dbModule
      .getDb()
      .insert(organizations)
      .values([
        {
          id: viewerOrgId,
          name: "Viewer organization",
          createdBy: owner,
          createdAt: Date.now(),
        },
        {
          id: otherOrgId,
          name: "Other organization",
          createdBy: owner,
          createdAt: Date.now(),
        },
      ]);
    await dbModule
      .getDb()
      .insert(orgMembers)
      .values({
        id: `${prefix}-viewer-membership`,
        orgId: viewerOrgId,
        email: viewer,
        role: "member",
        joinedAt: Date.now(),
      });
    const matrixDocuments = [
      { id: `${prefix}-public`, title: "Matrix public", visibility: "public" },
      {
        id: `${prefix}-org-visible`,
        title: "Matrix viewer org",
        visibility: "org",
        orgId: viewerOrgId,
      },
      {
        id: `${prefix}-org-hidden`,
        title: "Matrix other org hidden",
        visibility: "org",
        orgId: otherOrgId,
      },
      { id: `${prefix}-owner`, title: "Matrix owner-only" },
      {
        id: `${prefix}-percent`,
        title: "Matrix % literal",
        visibility: "public",
      },
      {
        id: `${prefix}-underscore`,
        title: "Matrix _ literal",
        visibility: "public",
      },
      {
        id: `${prefix}-slash`,
        title: "Matrix \\ literal",
        visibility: "public",
      },
      { id: `${prefix}-tie-a`, title: "Matrix tie", visibility: "public" },
      { id: `${prefix}-tie-b`, title: "Matrix tie", visibility: "public" },
      {
        id: `${prefix}-trashed`,
        title: "Matrix deleted trashed",
        visibility: "public",
        trashedAt: "2026-09-09T00:00:00.000Z",
      },
      {
        id: `${prefix}-permadeleted`,
        title: "Matrix deleted permanent",
        visibility: "public",
      },
    ];
    await dbModule
      .getDb()
      .insert(dbModule.schema.documents)
      .values(
        matrixDocuments.map((document) => ({
          ...document,
          spaceId,
          ownerEmail: owner,
        })),
      );
    await dbModule
      .getDb()
      .insert(dbModule.schema.contentDatabaseItems)
      .values(
        matrixDocuments.map((document, index) => ({
          id: `${document.id}-item`,
          databaseId: targetDatabaseId,
          documentId: document.id,
          ownerEmail: owner,
          position: 50 + index,
        })),
      );
    await dbModule
      .getDb()
      .insert(dbModule.schema.contentRelationshipEndpointStates)
      .values({
        pageId: `${prefix}-permadeleted`,
        ownerEmail: owner,
        spaceId,
        permanentlyDeletedAt: "2026-09-09T00:00:00.000Z",
      });

    const query = (userEmail: string, search: string, limit = 100) =>
      asUser(userEmail, () =>
        listCandidates.run({
          propertyId,
          anchorPageId,
          search,
          contextPropertyIds: [],
          limit,
        }),
      );
    await expect(query(viewer, "Matrix public")).resolves.toMatchObject({
      items: [{ pageId: `${prefix}-public` }],
    });
    await expect(query(viewer, "Matrix viewer org")).resolves.toMatchObject({
      items: [{ pageId: `${prefix}-org-visible` }],
    });
    await expect(
      query(viewer, "Matrix other org hidden"),
    ).resolves.toMatchObject({ items: [] });
    await expect(query(owner, "Matrix owner-only")).resolves.toMatchObject({
      items: [{ pageId: `${prefix}-owner` }],
    });
    for (const [search, id] of [
      ["%", `${prefix}-percent`],
      ["_", `${prefix}-underscore`],
      ["\\", `${prefix}-slash`],
    ]) {
      const result = await query(viewer, search, 10);
      expect(result.items.map((item) => item.pageId)).toEqual([id]);
    }
    const ties = await query(viewer, "Matrix tie", 10);
    expect(ties.items.map((item) => item.pageId)).toEqual([
      `${prefix}-tie-a`,
      `${prefix}-tie-b`,
    ]);
    const deleted = await query(viewer, "Matrix deleted", 10);
    expect(deleted.items).toEqual([]);
  });

  it("keeps candidate query work constant as hidden membership grows", async () => {
    const client = (dbModule.getDb() as any).$client;
    const query = vi.spyOn(client, "query");
    await asUser(viewer, () =>
      listCandidates.run({
        propertyId,
        anchorPageId,
        search: "",
        contextPropertyIds: [],
        limit: 1,
      }),
    );
    const smallFixtureQueries = query.mock.calls.length;
    expect(smallFixtureQueries).toBeGreaterThan(0);

    const hidden = Array.from({ length: 250 }, (_, index) => ({
      id: `${prefix}-bulk-hidden-${String(index).padStart(3, "0")}`,
      title: `Bulk hidden ${index}`,
    }));
    await dbModule
      .getDb()
      .insert(dbModule.schema.documents)
      .values(
        hidden.map((document) => ({
          ...document,
          spaceId,
          ownerEmail: owner,
        })),
      );
    await dbModule
      .getDb()
      .insert(dbModule.schema.contentDatabaseItems)
      .values(
        hidden.map((document, index) => ({
          id: `${document.id}-item`,
          databaseId: targetDatabaseId,
          documentId: document.id,
          ownerEmail: owner,
          position: 100 + index,
        })),
      );

    query.mockClear();
    await asUser(viewer, () =>
      listCandidates.run({
        propertyId,
        anchorPageId,
        search: "",
        contextPropertyIds: [],
        limit: 1,
      }),
    );
    expect(query.mock.calls.length).toBe(smallFixtureQueries);
    query.mockRestore();
  });

  it("includes Property configuration in both Database Page histories", async () => {
    const [sourceHistory, targetHistory] = await Promise.all([
      asUser(viewer, () =>
        listHistory.run({ pageId: sourceDatabasePageId, limit: 10 }),
      ),
      asUser(viewer, () =>
        listHistory.run({ pageId: targetDatabasePageId, limit: 10 }),
      ),
    ]);
    expect(sourceHistory.items.map((item) => item.revisionId)).toContain(
      configuredRevisionId,
    );
    expect(targetHistory.items.map((item) => item.revisionId)).toContain(
      configuredRevisionId,
    );
  });

  it("hides history when an owning Database Page is no longer accessible", async () => {
    const shareId = `${prefix}-viewer-share-1`;
    await dbModule
      .getDb()
      .delete(dbModule.schema.documentShares)
      .where(eq(dbModule.schema.documentShares.id, shareId));
    try {
      const history = await asUser(viewer, () =>
        listHistory.run({ pageId: sourceDatabasePageId, limit: 10 }),
      );
      expect(history.items.map((item) => item.revisionId)).not.toContain(
        configuredRevisionId,
      );
      await expect(
        asUser(viewer, () =>
          listHistory.run({ revisionId: configuredRevisionId }),
        ),
      ).rejects.toMatchObject({ errorCode: "NOT_ACCESSIBLE" });
    } finally {
      await dbModule.getDb().insert(dbModule.schema.documentShares).values({
        id: shareId,
        resourceId: targetDatabasePageId,
        principalType: "user",
        principalId: viewer,
        role: "viewer",
        createdBy: owner,
      });
    }
  });

  it("fails closed instead of returning partial history before indexing finishes", async () => {
    const revisionId = `${prefix}-unindexed-history`;
    await dbModule
      .getDb()
      .insert(dbModule.schema.contentRelationshipRevisions)
      .values({
        id: revisionId,
        ownerEmail: owner,
        spaceId,
        operationId: `${revisionId}-operation`,
        operation: "mutate-relationships",
        actorJson: JSON.stringify({ kind: "person", displayName: owner }),
        origin: "frontend",
        recoveryToken: `${revisionId}-recovery`,
      });
    await dbModule
      .getDb()
      .insert(dbModule.schema.contentRelationshipEvents)
      .values({
        id: `${revisionId}-event`,
        ownerEmail: owner,
        spaceId,
        revisionId,
        relationshipTypeId,
        relationshipTypeVersionId,
        kind: "relationship-added",
        actorJson: JSON.stringify({ kind: "person", displayName: owner }),
        origin: "frontend",
        targetsJson: JSON.stringify({
          lineageId: `${revisionId}-lineage`,
          sourcePageId: anchorPageId,
          targetPageId: candidateDocuments[0]!.id,
        }),
      });
    try {
      for (const input of [
        { pageId: sourceDatabasePageId },
        { relationshipTypeId },
      ]) {
        await expect(
          asUser(viewer, () => listHistory.run(input)),
        ).rejects.toMatchObject({ errorCode: "UNAVAILABLE" });
      }
      await expect(
        asUser(viewer, () => listHistory.run({ revisionId })),
      ).rejects.toMatchObject({ errorCode: "NOT_ACCESSIBLE" });
      await dbModule
        .getDb()
        .insert(dbModule.schema.contentRelationshipRevisionDocuments)
        .values(
          [
            anchorPageId,
            candidateDocuments[0]!.id,
            sourceDatabasePageId,
            targetDatabasePageId,
          ].map((documentId, index) => ({
            id: `${revisionId}-document-${index}`,
            ownerEmail: owner,
            spaceId,
            revisionId,
            documentId,
          })),
        );
      await expect(
        asUser(viewer, () => listHistory.run({ revisionId })),
      ).rejects.toMatchObject({ errorCode: "NOT_ACCESSIBLE" });
      await expect(
        asUser(viewer, () =>
          listHistory.run({ revisionId: configuredRevisionId }),
        ),
      ).resolves.toMatchObject({
        items: [{ revisionId: configuredRevisionId }],
      });
    } finally {
      await dbModule
        .getDb()
        .delete(dbModule.schema.contentRelationshipRevisionDocuments)
        .where(
          eq(
            dbModule.schema.contentRelationshipRevisionDocuments.revisionId,
            revisionId,
          ),
        );
      await dbModule
        .getDb()
        .delete(dbModule.schema.contentRelationshipEvents)
        .where(
          eq(dbModule.schema.contentRelationshipEvents.revisionId, revisionId),
        );
      await dbModule
        .getDb()
        .delete(dbModule.schema.contentRelationshipRevisions)
        .where(eq(dbModule.schema.contentRelationshipRevisions.id, revisionId));
    }
  });

  it("reports a committed Revision with no Events as unavailable", async () => {
    const revisionId = `${prefix}-empty-history`;
    await dbModule
      .getDb()
      .insert(dbModule.schema.contentRelationshipRevisions)
      .values({
        id: revisionId,
        ownerEmail: owner,
        spaceId,
        operationId: `${revisionId}-operation`,
        operation: "mutate-relationships",
        actorJson: JSON.stringify({ kind: "person", displayName: owner }),
        origin: "frontend",
        recoveryToken: `${revisionId}-recovery`,
      });
    await dbModule
      .getDb()
      .insert(dbModule.schema.contentRelationshipRevisionDocuments)
      .values(
        [sourceDatabasePageId, targetDatabasePageId].map(
          (documentId, index) => ({
            id: `${revisionId}-document-${index}`,
            ownerEmail: owner,
            spaceId,
            revisionId,
            documentId,
          }),
        ),
      );
    try {
      await expect(
        asUser(viewer, () => listHistory.run({ pageId: sourceDatabasePageId })),
      ).rejects.toMatchObject({ errorCode: "UNAVAILABLE" });
      await expect(
        asUser(viewer, () => listHistory.run({ revisionId })),
      ).rejects.toMatchObject({ errorCode: "UNAVAILABLE" });
    } finally {
      await dbModule
        .getDb()
        .delete(dbModule.schema.contentRelationshipRevisionDocuments)
        .where(
          eq(
            dbModule.schema.contentRelationshipRevisionDocuments.revisionId,
            revisionId,
          ),
        );
      await dbModule
        .getDb()
        .delete(dbModule.schema.contentRelationshipRevisions)
        .where(eq(dbModule.schema.contentRelationshipRevisions.id, revisionId));
    }
  });

  it("paginates authorized history without exposing hidden revisions in the cursor", async () => {
    const createdAt = "2026-09-09T12:00:00.000Z";
    const revisions = [
      { id: `${prefix}-history-6`, target: candidateDocuments[1]!.id },
      { id: `${prefix}-history-5`, target: candidateDocuments[0]!.id },
      { id: `${prefix}-history-4`, target: candidateDocuments[3]!.id },
      { id: `${prefix}-history-3`, target: candidateDocuments[2]!.id },
      { id: `${prefix}-history-2`, target: candidateDocuments[5]!.id },
      { id: `${prefix}-history-1`, target: candidateDocuments[4]!.id },
    ];
    await dbModule
      .getDb()
      .insert(dbModule.schema.contentRelationshipRevisions)
      .values(
        revisions.map(({ id }) => ({
          id,
          ownerEmail: owner,
          spaceId,
          operationId: `${id}-operation`,
          operation: "mutate-relationships",
          actorJson: JSON.stringify({
            kind: "person",
            displayName: owner,
            email: owner,
          }),
          authorizingPrincipalJson: JSON.stringify({
            kind: "user",
            email: owner,
            orgId: null,
          }),
          origin: "frontend",
          recoveryToken: `${id}-recovery`,
          createdAt,
        })),
      );
    await dbModule
      .getDb()
      .insert(dbModule.schema.contentRelationshipEvents)
      .values(
        revisions.map(({ id, target }) => ({
          id: `${id}-event`,
          ownerEmail: owner,
          spaceId,
          revisionId: id,
          relationshipTypeId,
          relationshipTypeVersionId,
          kind: "relationship-added",
          actorJson: JSON.stringify({ kind: "person", displayName: owner }),
          authorizingPrincipalJson: JSON.stringify({
            kind: "user",
            email: owner,
            orgId: null,
          }),
          origin: "frontend",
          targetsJson: JSON.stringify({
            lineageId: `${id}-lineage`,
            sourcePageId: anchorPageId,
            targetPageId: target,
          }),
        })),
      );
    await dbModule
      .getDb()
      .insert(dbModule.schema.contentRelationshipRevisionDocuments)
      .values(
        revisions.flatMap(({ id, target }) =>
          [
            anchorPageId,
            target,
            sourceDatabasePageId,
            targetDatabasePageId,
          ].map((documentId, index) => ({
            id: `${id}-document-${index}`,
            ownerEmail: owner,
            spaceId,
            revisionId: id,
            documentId,
          })),
        ),
      );

    const first = await asUser(viewer, () =>
      listHistory.run({ pageId: anchorPageId, limit: 2 }),
    );
    expect(first.items.map((item) => item.revisionId)).toEqual([
      `${prefix}-history-6`,
      `${prefix}-history-4`,
    ]);
    expect(first.nextCursor).toBeTruthy();

    const second = await asUser(viewer, () =>
      listHistory.run({
        pageId: anchorPageId,
        limit: 2,
        cursor: first.nextCursor!,
      }),
    );
    expect(second.items.map((item) => item.revisionId)).toEqual([
      `${prefix}-history-2`,
    ]);
    expect(second.nextCursor).toBeNull();
  });

  it("never treats a colliding unresolved reference as a document grant", async () => {
    const revisionId = `${prefix}-history-6`;
    const tombstoneId = `${revisionId}-unresolved-collision`;
    await dbModule
      .getDb()
      .insert(dbModule.schema.contentRelationshipRevisionDocuments)
      .values({
        id: tombstoneId,
        ownerEmail: owner,
        spaceId,
        revisionId,
        documentId: anchorPageId,
        unresolved: 1,
      });
    try {
      const history = await asUser(viewer, () =>
        listHistory.run({ pageId: anchorPageId, limit: 10 }),
      );
      expect(history.items.map((item) => item.revisionId)).not.toContain(
        revisionId,
      );
      await expect(
        asUser(viewer, () => listHistory.run({ revisionId })),
      ).rejects.toMatchObject({ errorCode: "NOT_ACCESSIBLE" });
    } finally {
      await dbModule
        .getDb()
        .delete(dbModule.schema.contentRelationshipRevisionDocuments)
        .where(
          eq(
            dbModule.schema.contentRelationshipRevisionDocuments.id,
            tombstoneId,
          ),
        );
    }
  });

  it("keeps history detail-query work constant as hidden revisions grow", async () => {
    const client = (dbModule.getDb() as any).$client;
    const query = vi.spyOn(client, "query");
    await asUser(viewer, () =>
      listHistory.run({ pageId: anchorPageId, limit: 1 }),
    );
    const smallFixtureQueries = query.mock.calls.length;
    expect(smallFixtureQueries).toBeGreaterThan(0);

    const hiddenRevisions = Array.from({ length: 250 }, (_, index) => ({
      id: `${prefix}-bulk-history-${String(index).padStart(3, "0")}`,
      target: candidateDocuments[0]!.id,
    }));
    await dbModule
      .getDb()
      .insert(dbModule.schema.contentRelationshipRevisions)
      .values(
        hiddenRevisions.map(({ id }) => ({
          id,
          ownerEmail: owner,
          spaceId,
          operationId: `${id}-operation`,
          operation: "mutate-relationships",
          actorJson: JSON.stringify({
            kind: "person",
            displayName: owner,
            email: owner,
          }),
          authorizingPrincipalJson: JSON.stringify({
            kind: "user",
            email: owner,
            orgId: null,
          }),
          origin: "frontend",
          recoveryToken: `${id}-recovery`,
          createdAt: "2020-01-01T00:00:00.000Z",
        })),
      );
    await dbModule
      .getDb()
      .insert(dbModule.schema.contentRelationshipEvents)
      .values(
        hiddenRevisions.map(({ id, target }) => ({
          id: `${id}-event`,
          ownerEmail: owner,
          spaceId,
          revisionId: id,
          relationshipTypeId,
          relationshipTypeVersionId,
          kind: "relationship-added",
          actorJson: JSON.stringify({ kind: "person", displayName: owner }),
          authorizingPrincipalJson: JSON.stringify({
            kind: "user",
            email: owner,
            orgId: null,
          }),
          origin: "frontend",
          targetsJson: JSON.stringify({
            lineageId: `${id}-lineage`,
            sourcePageId: anchorPageId,
            targetPageId: target,
          }),
        })),
      );
    await dbModule
      .getDb()
      .insert(dbModule.schema.contentRelationshipRevisionDocuments)
      .values(
        hiddenRevisions.flatMap(({ id, target }) =>
          [
            anchorPageId,
            target,
            sourceDatabasePageId,
            targetDatabasePageId,
          ].map((documentId, index) => ({
            id: `${id}-document-${index}`,
            ownerEmail: owner,
            spaceId,
            revisionId: id,
            documentId,
          })),
        ),
      );

    query.mockClear();
    await asUser(viewer, () =>
      listHistory.run({ pageId: anchorPageId, limit: 1 }),
    );
    expect(query.mock.calls.length).toBe(smallFixtureQueries);
    query.mockRestore();
  });

  it("keeps purged endpoint audit references private", async () => {
    const revisionId = `${prefix}-history-6`;
    await dbModule
      .getDb()
      .delete(dbModule.schema.documents)
      .where(eq(dbModule.schema.documents.id, candidateDocuments[1]!.id));

    const history = await asUser(viewer, () =>
      listHistory.run({ pageId: anchorPageId, limit: 10 }),
    );
    expect(history.items.map((item) => item.revisionId)).not.toContain(
      revisionId,
    );
    await expect(
      asUser(viewer, () => listHistory.run({ revisionId })),
    ).rejects.toMatchObject({ errorCode: "NOT_ACCESSIBLE" });
  });
});
