import { runWithRequestContext } from "@agent-native/core/server";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const POSTGRES_URL = process.env.CONTENT_RELATIONSHIP_POSTGRES_URL;
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
const owner = "relationship-concurrency-owner@example.test";

let getDb: () => any;
let schema: typeof import("../server/db/schema.js");
let configure: typeof import("./configure-content-relation-property.js").default;
let mutate: typeof import("./mutate-content-relationships.js").default;
let list: typeof import("./list-content-relationships.js").default;
let nextFixture = 0;
let spaceId: string;

const asOwner = <T>(run: () => Promise<T>) =>
  runWithRequestContext({ userEmail: owner }, run);

beforeAll(async () => {
  if (!POSTGRES_URL) return;
  const databaseName = new URL(POSTGRES_URL).pathname.slice(1).toLowerCase();
  if (!databaseName.includes("test")) {
    throw new Error(
      "CONTENT_RELATIONSHIP_POSTGRES_URL must name an isolated test database.",
    );
  }
  process.env.DATABASE_URL = POSTGRES_URL;
  const database = await import("../server/db/index.js");
  getDb = database.getDb;
  schema = database.schema;
  configure = (await import("./configure-content-relation-property.js"))
    .default;
  mutate = (await import("./mutate-content-relationships.js")).default;
  list = (await import("./list-content-relationships.js")).default;
  await (await import("../server/plugins/db.js")).default(undefined as never);

  spaceId = `relationship-concurrency-${process.pid}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
  const filesDatabaseId = `${spaceId}-files`;
  await getDb().insert(schema.contentSpaces).values({
    id: spaceId,
    name: "Relationship concurrency",
    kind: "personal",
    ownerEmail: owner,
    filesDatabaseId,
    createdBy: owner,
  });
  await getDb()
    .insert(schema.documents)
    .values({
      id: `${filesDatabaseId}-page`,
      spaceId,
      ownerEmail: owner,
      title: "Files",
    });
  await getDb()
    .insert(schema.contentDatabases)
    .values({
      id: filesDatabaseId,
      documentId: `${filesDatabaseId}-page`,
      spaceId,
      ownerEmail: owner,
      title: "Files",
      systemRole: "files",
      blocksSeeded: 1,
    });
}, 60_000);

afterAll(() => {
  if (ORIGINAL_DATABASE_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
});

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function fixture(cardinality: "one" | "many" = "many") {
  const prefix = `${spaceId}-${++nextFixture}`;
  const sourceDatabaseId = `${prefix}-deliverables`;
  const targetDatabaseId = `${prefix}-people`;
  const sourcePageId = `${prefix}-launch`;
  const targetPageIds = [`${prefix}-mira`, `${prefix}-jo`, `${prefix}-sam`];
  await getDb()
    .insert(schema.documents)
    .values([
      {
        id: `${sourceDatabaseId}-page`,
        spaceId,
        ownerEmail: owner,
        title: "Campaign deliverables",
      },
      {
        id: `${targetDatabaseId}-page`,
        spaceId,
        ownerEmail: owner,
        title: "Marketing team",
      },
      {
        id: sourcePageId,
        spaceId,
        ownerEmail: owner,
        title: "Launch article",
      },
      ...targetPageIds.map((id, index) => ({
        id,
        spaceId,
        ownerEmail: owner,
        title: ["Mira", "Jo", "Sam"][index]!,
      })),
    ]);
  await getDb()
    .insert(schema.contentDatabases)
    .values([
      {
        id: sourceDatabaseId,
        spaceId,
        ownerEmail: owner,
        documentId: `${sourceDatabaseId}-page`,
        title: "Deliverables",
        blocksSeeded: 1,
      },
      {
        id: targetDatabaseId,
        spaceId,
        ownerEmail: owner,
        documentId: `${targetDatabaseId}-page`,
        title: "People",
        blocksSeeded: 1,
      },
    ]);
  await getDb()
    .insert(schema.contentDatabaseItems)
    .values([
      {
        id: `${prefix}-source-item`,
        databaseId: sourceDatabaseId,
        documentId: sourcePageId,
        ownerEmail: owner,
      },
      ...targetPageIds.map((documentId, index) => ({
        id: `${prefix}-target-item-${index}`,
        databaseId: targetDatabaseId,
        documentId,
        ownerEmail: owner,
        position: index,
      })),
    ]);
  const configured = await asOwner(() =>
    configure.run({
      ownerDatabaseId: sourceDatabaseId,
      alias: cardinality === "one" ? "Assignee" : "Contributors",
      operationId: `${prefix}-configure`,
      definition: {
        kind: "new-local",
        forwardLabel: cardinality === "one" ? "Assigned to" : "Contributes to",
        inverseLabel: "Deliverables",
        forwardCardinality: cardinality,
        sourceDatabaseId,
        targetDatabaseId,
      },
      inverseProjection: {
        ownerDatabaseId: targetDatabaseId,
        alias: "Deliverables",
        editable: true,
      },
    }),
  );
  return {
    prefix,
    sourceDatabaseId,
    targetDatabaseId,
    sourcePageId,
    targetPageIds,
    typeId: configured.relationshipType.id,
    typeVersionId: configured.relationshipTypeVersion.id,
    propertyId: configured.projection.propertyId,
  };
}

function addInput(seed: Fixture, operationId: string, targetPageId: string) {
  return {
    operationId,
    changes: [
      {
        kind: "add" as const,
        typeId: seed.typeId,
        typeVersionId: seed.typeVersionId,
        sourcePageId: seed.sourcePageId,
        targetPageId,
        route: {
          kind: "forward-property" as const,
          propertyId: seed.propertyId,
          sourcePageId: seed.sourcePageId,
        },
      },
    ],
  };
}

async function add(seed: Fixture, operationId: string, targetPageId: string) {
  return asOwner(() => mutate.run(addInput(seed, operationId, targetPageId)));
}

async function sourceRelationships(seed: Fixture) {
  return asOwner(() =>
    list.run({
      pageId: seed.sourcePageId,
      relationshipTypeId: seed.typeId,
      direction: "outgoing",
    }),
  );
}

async function proveSeparatePostgresTransactions() {
  let arrivals = 0;
  let release!: () => void;
  const bothConnectionsArrived = new Promise<void>((resolve) => {
    release = resolve;
  });
  const enter = () =>
    getDb().transaction(async (tx: any) => {
      const result = await tx.execute(sql`select pg_backend_pid() as pid`);
      const rows = Array.isArray(result) ? result : result.rows;
      const pid = Number(rows[0].pid);
      arrivals += 1;
      if (arrivals === 2) release();
      await bothConnectionsArrived;
      return pid;
    });
  const pids = await Promise.all([enter(), enter()]);
  expect(new Set(pids).size).toBe(2);
}

const postgresSuite = POSTGRES_URL ? describe : describe.skip;

postgresSuite("typed relationship PostgreSQL concurrency", () => {
  it("executes overlapping transactions on separate PostgreSQL connections", async () => {
    await proveSeparatePostgresTransactions();
  });

  it("converges concurrent adds of the same tuple on one visible edge", async () => {
    const seed = await fixture();
    const [first, second] = await Promise.all([
      add(seed, `${seed.prefix}-add-a`, seed.targetPageIds[0]!),
      add(seed, `${seed.prefix}-add-b`, seed.targetPageIds[0]!),
    ]);

    expect(first.results[0]!.edgeId).toBe(second.results[0]!.edgeId);
    expect(first.results[0]!.activationIds).not.toEqual(
      second.results[0]!.activationIds,
    );
    const current = await sourceRelationships(seed);
    expect(current.items).toHaveLength(1);
    expect(current.items[0]!.observedActivationIds.sort()).toEqual(
      [
        ...first.results[0]!.activationIds,
        ...second.results[0]!.activationIds,
      ].sort(),
    );
  });

  it("preserves an unseen concurrent add when removing a stale observation", async () => {
    const seed = await fixture();
    const initial = await add(
      seed,
      `${seed.prefix}-initial-add`,
      seed.targetPageIds[0]!,
    );
    const observed = (await sourceRelationships(seed)).items[0]!;
    const removeInput = {
      operationId: `${seed.prefix}-stale-remove`,
      changes: [
        {
          kind: "remove" as const,
          edgeId: observed.edgeId,
          observedActivationIds: observed.observedActivationIds,
          observationToken: observed.observationToken,
          route: {
            kind: "forward-property" as const,
            propertyId: seed.propertyId,
            sourcePageId: seed.sourcePageId,
          },
        },
      ],
    };
    const [removed, added] = await Promise.all([
      asOwner(() => mutate.run(removeInput)),
      add(seed, `${seed.prefix}-concurrent-add`, seed.targetPageIds[0]!),
    ]);

    expect(removed.results[0]!.activationIds).toEqual(
      initial.results[0]!.activationIds,
    );
    const current = await sourceRelationships(seed);
    expect(current.items).toHaveLength(1);
    expect(current.items[0]!.observedActivationIds).toEqual(
      added.results[0]!.activationIds,
    );
  });

  it("replays a concurrent repeated operation with one stable receipt", async () => {
    const seed = await fixture();
    const input = addInput(
      seed,
      `${seed.prefix}-repeated-operation`,
      seed.targetPageIds[0]!,
    );
    const [first, second] = await Promise.all([
      asOwner(() => mutate.run(input)),
      asOwner(() => mutate.run(input)),
    ]);

    expect(second).toEqual(first);
    const current = await sourceRelationships(seed);
    expect(current.items).toHaveLength(1);
    expect(current.items[0]!.observedActivationIds).toEqual(
      first.results[0]!.activationIds,
    );
    const receipts = await getDb()
      .select()
      .from(schema.contentRelationshipReceipts)
      .where(
        eq(schema.contentRelationshipReceipts.operationId, input.operationId),
      );
    expect(receipts).toHaveLength(1);
  });

  it("rejects a concurrent operation ID collision with a typed conflict", async () => {
    const seed = await fixture();
    const operationId = `${seed.prefix}-conflicting-operation`;
    const settled = await Promise.allSettled([
      add(seed, operationId, seed.targetPageIds[0]!),
      add(seed, operationId, seed.targetPageIds[1]!),
    ]);
    const fulfilled = settled.filter(
      (
        result,
      ): result is PromiseFulfilledResult<Awaited<ReturnType<typeof add>>> =>
        result.status === "fulfilled",
    );
    const rejected = settled.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({
      errorCode: "IDEMPOTENCY_CONFLICT",
    });
    const current = await sourceRelationships(seed);
    expect(current.items).toHaveLength(1);
    expect(current.items[0]!.edgeId).toBe(
      fulfilled[0]!.value.results[0]!.edgeId,
    );
  });

  it("serializes conflicting operation IDs across disjoint database pairs", async () => {
    const first = await fixture();
    const second = await fixture();
    const operationId = `${first.prefix}-cross-database-operation`;
    const outcomes = await Promise.allSettled([
      add(first, operationId, first.targetPageIds[0]!),
      add(second, operationId, second.targetPageIds[0]!),
    ]);
    expect(
      outcomes.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const denied = outcomes.find((result) => result.status === "rejected");
    expect(denied?.status === "rejected" && denied.reason).toMatchObject({
      errorCode: "IDEMPOTENCY_CONFLICT",
    });
    const [firstState, secondState] = await Promise.all([
      sourceRelationships(first),
      sourceRelationships(second),
    ]);
    expect(firstState.items.length + secondState.items.length).toBe(1);
  });

  it("serializes concurrent max-one replacements with explicit history", async () => {
    const seed = await fixture("one");
    await add(seed, `${seed.prefix}-initial-choice`, seed.targetPageIds[0]!);
    const observed = (await sourceRelationships(seed)).items[0]!;
    expect(observed.slotObservationToken).toBeTruthy();
    const replaceInput = (targetPageId: string, suffix: string) => ({
      operationId: `${seed.prefix}-replace-${suffix}`,
      changes: [
        {
          kind: "replace" as const,
          typeId: seed.typeId,
          typeVersionId: seed.typeVersionId,
          sourcePageId: seed.sourcePageId,
          targetPageId,
          observedSlotToken: observed.slotObservationToken!,
          route: {
            kind: "forward-property" as const,
            propertyId: seed.propertyId,
            sourcePageId: seed.sourcePageId,
          },
        },
      ],
    });
    const settled = await Promise.allSettled([
      asOwner(() => mutate.run(replaceInput(seed.targetPageIds[1]!, "jo"))),
      asOwner(() => mutate.run(replaceInput(seed.targetPageIds[2]!, "sam"))),
    ]);
    const fulfilled = settled.filter(
      (
        result,
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof mutate.run>>
      > => result.status === "fulfilled",
    );
    const rejected = settled.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );

    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    for (const failure of rejected) {
      expect(failure.reason).toMatchObject({ errorCode: "STALE_SELECTION" });
    }
    const current = await sourceRelationships(seed);
    expect(current.items).toHaveLength(1);
    expect(seed.targetPageIds.slice(1)).toContain(
      current.items[0]!.targetPageId,
    );
    expect(
      fulfilled.some(
        ({ value }) => value.results[0]!.edgeId === current.items[0]!.edgeId,
      ),
    ).toBe(true);

    const revisionIds = fulfilled.map(({ value }) => value.revisionId);
    const revisions = await getDb()
      .select()
      .from(schema.contentRelationshipRevisions)
      .where(inArray(schema.contentRelationshipRevisions.id, revisionIds));
    const events = await getDb()
      .select()
      .from(schema.contentRelationshipEvents)
      .where(inArray(schema.contentRelationshipEvents.revisionId, revisionIds));
    expect(revisions).toHaveLength(fulfilled.length);
    expect(events).toHaveLength(fulfilled.length);
    expect(
      events.every((event: any) => event.kind === "relationship-replaced"),
    ).toBe(true);
    for (const success of fulfilled) {
      expect(success.value.results[0]).toMatchObject({
        kind: "replace",
        state: "active",
      });
      expect(
        success.value.results[0]!.displacedEdgeIds?.length,
      ).toBeGreaterThan(0);
    }
  });

  it("serializes first admission with endpoint trash and restores only committed knowledge", async () => {
    const seed = await fixture();
    const trash = (await import("./delete-document.js")).default;
    const restore = (await import("./restore-document.js")).default;
    const target = seed.targetPageIds[0]!;
    const [admission, deletion] = await Promise.allSettled([
      add(seed, `${seed.prefix}-race-add-trash`, target),
      asOwner(() => trash.run({ id: target })),
    ]);
    expect(deletion.status).toBe("fulfilled");
    if (admission.status === "rejected") {
      expect(admission.reason).toMatchObject({ errorCode: "INVALID_TARGET" });
    }
    const trashed = await sourceRelationships(seed);
    expect(trashed.items.every((edge) => edge.state !== "active")).toBe(true);
    await asOwner(() => restore.run({ id: target }));
    const restored = await sourceRelationships(seed);
    expect(restored.items).toHaveLength(
      admission.status === "fulfilled" ? 1 : 0,
    );
    if (admission.status === "fulfilled") {
      expect(restored.items[0]).toMatchObject({
        edgeId: admission.value.results[0]!.edgeId,
        state: "active",
      });
    }
  });

  it("does not resurrect an observed removal committed concurrently with trash", async () => {
    const seed = await fixture();
    const target = seed.targetPageIds[0]!;
    await add(seed, `${seed.prefix}-before-trash`, target);
    const observed = (await sourceRelationships(seed)).items[0]!;
    const trash = (await import("./delete-document.js")).default;
    const restore = (await import("./restore-document.js")).default;
    await Promise.all([
      asOwner(() =>
        mutate.run({
          operationId: `${seed.prefix}-remove-with-trash`,
          changes: [
            {
              kind: "remove",
              edgeId: observed.edgeId,
              observedActivationIds: observed.observedActivationIds,
              observationToken: observed.observationToken,
              route: {
                kind: "forward-property",
                propertyId: seed.propertyId,
                sourcePageId: seed.sourcePageId,
              },
            },
          ],
        }),
      ),
      asOwner(() => trash.run({ id: target })),
    ]);
    await asOwner(() => restore.run({ id: target }));
    expect((await sourceRelationships(seed)).items).toHaveLength(0);
  });
});
