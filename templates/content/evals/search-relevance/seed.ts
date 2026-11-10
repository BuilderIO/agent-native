import {
  BLOG_POSTS_COLLECTION_KEY,
  corpusDocuments,
  docId,
  OUTSIDER_EMAIL,
  OWNER_EMAIL,
  SPACE_IDS,
  TASK_PRIORITIES_COLLECTION_KEY,
  type CorpusSpace,
} from "./corpus.js";

type Schema = typeof import("../../server/db/schema.js");
type GetDb = typeof import("../../server/db/index.js").getDb;

/** Seeds the invented corpus into a fresh Content database. */
export async function seedSearchEvalCorpus(getDb: GetDb, schema: Schema) {
  const spaceOwner = (space: CorpusSpace) =>
    space === "outsider" ? OUTSIDER_EMAIL : OWNER_EMAIL;

  const now = new Date().toISOString();
  await getDb()
    .insert(schema.contentSpaces)
    .values(
      (Object.keys(SPACE_IDS) as CorpusSpace[]).map((space) => ({
        id: SPACE_IDS[space],
        name:
          space === "personal"
            ? "Personal space"
            : space === "org"
              ? "Meridian Analytics workspace"
              : "Cobalt Metrics workspace",
        kind: space === "org" || space === "outsider" ? "org" : "personal",
        ownerEmail: spaceOwner(space),
        orgId: null,
        filesDatabaseId: `${SPACE_IDS[space]}-files`,
        createdBy: spaceOwner(space),
        createdAt: now,
        updatedAt: now,
      })),
    );

  // Deterministic, monotonically increasing timestamps across the whole
  // corpus so ranking tie-breaks (updatedAt desc, id asc) never depend on
  // wall-clock insert timing.
  const BASE_TIME = Date.parse("2026-01-06T09:00:00.000Z");
  const DAY_MS = 24 * 60 * 60 * 1000;

  const documentRows = corpusDocuments.map((doc, index) => {
    const timestamp = new Date(BASE_TIME + index * DAY_MS).toISOString();
    return {
      id: docId(doc.key),
      spaceId: SPACE_IDS[doc.space],
      ownerEmail: spaceOwner(doc.space),
      orgId: null,
      parentId: doc.parentKey ? docId(doc.parentKey) : null,
      title: doc.title,
      content: doc.body,
      description: doc.description ?? "",
      position: index,
      visibility: "private" as const,
      hideFromSearch: doc.hideFromSearch ? 1 : 0,
      trashedAt: doc.trashed ? timestamp : null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  });
  for (let start = 0; start < documentRows.length; start += 100) {
    await getDb()
      .insert(schema.documents)
      .values(documentRows.slice(start, start + 100));
  }

  await getDb()
    .insert(schema.contentDatabases)
    .values([
      {
        id: "db-blog-posts",
        spaceId: SPACE_IDS.org,
        ownerEmail: OWNER_EMAIL,
        documentId: docId(BLOG_POSTS_COLLECTION_KEY),
        title: "Blog posts",
      },
      {
        id: "db-task-priorities",
        spaceId: SPACE_IDS.org,
        ownerEmail: OWNER_EMAIL,
        documentId: docId(TASK_PRIORITIES_COLLECTION_KEY),
        title: "Task Priorities",
      },
    ]);

  const membershipRows = corpusDocuments
    .filter((doc) => doc.collection)
    .map((doc, index) => ({
      id: `item-${doc.key}`,
      ownerEmail: OWNER_EMAIL,
      databaseId:
        doc.collection === "blog-posts"
          ? "db-blog-posts"
          : "db-task-priorities",
      documentId: docId(doc.key),
      position: index,
    }));
  if (membershipRows.length) {
    await getDb().insert(schema.contentDatabaseItems).values(membershipRows);
  }
}
