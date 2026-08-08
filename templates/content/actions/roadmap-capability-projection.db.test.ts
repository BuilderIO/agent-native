import { readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { fileURLToPath } from "node:url";

import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-roadmap-projection-${process.pid}-${Date.now()}.sqlite`,
);
const OWNER = "roadmap-projection-owner@example.com";
const OUTSIDER = "roadmap-projection-outsider@example.com";
const SOURCE_REVISION = "b5a07715c6f0240e22daa6ecaba86ecc46513b08";
const PROJECTION_TITLE = `Content roadmap capabilities — ${SOURCE_REVISION.slice(0, 12)}`;
const CAPABILITIES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../docs/product/capabilities",
);

type Capability = {
  id: string;
  name: string;
  state: string;
  publicness: string;
  userPromise: string;
  body: string;
};

let getDb: () => any;
let schema: typeof import("../server/db/schema.js");
let provisionContentSpaces: typeof import("./_content-spaces.js").provisionContentSpaces;
let createDatabase: typeof import("./create-content-database.js").default;
let configureProperty: typeof import("./configure-document-property.js").default;
let getDatabase: typeof import("./get-content-database.js").default;
let searchDocuments: typeof import("./search-documents.js").default;
let upsert: typeof import("./upsert-database-item-by-key.js").default;

const asUser = <T>(userEmail: string, run: () => Promise<T>) =>
  runWithRequestContext({ userEmail }, run);

function frontmatterValue(source: string, key: string) {
  const frontmatter = source.split("---", 3)[1] ?? "";
  const match = frontmatter.match(
    new RegExp(`^${key}:\\s*(?:"([^"]*)"|'([^']*)'|([^\\n]+))$`, "m"),
  );
  if (!match) throw new Error(`Capability record is missing ${key}.`);
  return (match[1] ?? match[2] ?? match[3] ?? "").trim();
}

function loadCapabilities(): Capability[] {
  return readdirSync(CAPABILITIES_DIR)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => {
      const body = readFileSync(join(CAPABILITIES_DIR, name), "utf8");
      return {
        id: frontmatterValue(body, "id"),
        name: frontmatterValue(body, "name"),
        state: frontmatterValue(body, "state"),
        publicness: frontmatterValue(body, "publicness"),
        userPromise: frontmatterValue(body, "user_promise"),
        body,
      };
    });
}

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  ({ provisionContentSpaces } = await import("./_content-spaces.js"));
  createDatabase = (await import("./create-content-database.js")).default;
  configureProperty = (await import("./configure-document-property.js"))
    .default;
  getDatabase = (await import("./get-content-database.js")).default;
  searchDocuments = (await import("./search-documents.js")).default;
  upsert = (await import("./upsert-database-item-by-key.js")).default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
}, 60_000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"])
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
});

describe("private roadmap capability projection", () => {
  it("projects and replays all 124 capability IDs through stable-key upsert, then exhausts paginated readback", async () => {
    const capabilities = loadCapabilities();
    expect(capabilities).toHaveLength(124);
    expect(new Set(capabilities.map((capability) => capability.id)).size).toBe(
      124,
    );

    const provisioned = await asUser(OWNER, () =>
      provisionContentSpaces(getDb(), OWNER),
    );
    const absent = await asUser(OWNER, () =>
      searchDocuments.run({
        exactTitle: PROJECTION_TITLE,
        parentId: null,
        spaceId: provisioned.personalSpaceId,
        documentType: "database",
        limit: 10,
        offset: 0,
      }),
    );
    expect(absent).toMatchObject({
      documents: [],
      pagination: {
        totalItems: 0,
        returnedItems: 0,
        hasMore: false,
        nextOffset: null,
      },
    });

    const createdDatabase = await asUser(OWNER, () =>
      createDatabase.run({
        spaceId: provisioned.personalSpaceId,
        parentId: null,
        title: PROJECTION_TITLE,
        description: `Private projection of Content capability records at ${SOURCE_REVISION}.`,
      }),
    );
    const databaseId = createdDatabase.database.id;
    const databaseDocumentId = createdDatabase.database.documentId;
    const propertyIds = new Map<string, string>();
    for (const [name, type] of [
      ["Capability ID", "text"],
      ["State", "text"],
      ["Publicness", "text"],
      ["User promise", "text"],
      ["Source revision", "text"],
    ] as const) {
      const configured = await asUser(OWNER, () =>
        configureProperty.run({
          documentId: databaseDocumentId,
          databaseId,
          name,
          type,
        }),
      );
      const property = configured.properties.find(
        (candidate) => candidate.definition.name === name,
      );
      if (!property)
        throw new Error(`Projection property "${name}" was not created.`);
      propertyIds.set(name, property.definition.id);
    }
    const keyPropertyId = propertyIds.get("Capability ID");
    if (!keyPropertyId)
      throw new Error("Projection stable-key property was not created.");

    const firstReceipts = new Map<
      string,
      { itemId: string; documentId: string }
    >();
    for (const capability of capabilities) {
      const receipt = await asUser(OWNER, () =>
        upsert.run({
          databaseId,
          keyPropertyId,
          keyValue: capability.id,
          title: capability.name,
          body: capability.body,
          propertyValues: {
            [propertyIds.get("State")!]: capability.state,
            [propertyIds.get("Publicness")!]: capability.publicness,
            [propertyIds.get("User promise")!]: capability.userPromise,
            [propertyIds.get("Source revision")!]: SOURCE_REVISION,
          },
        }),
      );
      expect(receipt.status).toBe("created");
      firstReceipts.set(capability.id, {
        itemId: receipt.itemId,
        documentId: receipt.documentId,
      });
    }

    const changedCapability = capabilities[0];
    if (!changedCapability)
      throw new Error("Capability projection source is unexpectedly empty.");
    const changedIdentity = firstReceipts.get(changedCapability.id);
    if (!changedIdentity)
      throw new Error("Changed Capability is missing its first receipt.");
    const changedReceipt = await asUser(OWNER, () =>
      upsert.run({
        databaseId,
        keyPropertyId,
        keyValue: changedCapability.id,
        title: `${changedCapability.name} — changed`,
      }),
    );
    expect(changedReceipt).toMatchObject({
      status: "updated",
      ...changedIdentity,
    });
    const restoredReceipt = await asUser(OWNER, () =>
      upsert.run({
        databaseId,
        keyPropertyId,
        keyValue: changedCapability.id,
        title: changedCapability.name,
        body: changedCapability.body,
        propertyValues: {
          [propertyIds.get("State")!]: changedCapability.state,
          [propertyIds.get("Publicness")!]: changedCapability.publicness,
          [propertyIds.get("User promise")!]: changedCapability.userPromise,
          [propertyIds.get("Source revision")!]: SOURCE_REVISION,
        },
      }),
    );
    expect(restoredReceipt).toMatchObject({
      status: "updated",
      ...changedIdentity,
    });

    for (const capability of capabilities) {
      const receipt = await asUser(OWNER, () =>
        upsert.run({
          databaseId,
          keyPropertyId,
          keyValue: capability.id,
          title: capability.name,
          body: capability.body,
          propertyValues: {
            [propertyIds.get("State")!]: capability.state,
            [propertyIds.get("Publicness")!]: capability.publicness,
            [propertyIds.get("User promise")!]: capability.userPromise,
            [propertyIds.get("Source revision")!]: SOURCE_REVISION,
          },
        }),
      );
      expect(receipt).toMatchObject({
        status: "unchanged",
        ...firstReceipts.get(capability.id),
      });
    }

    const readbackIds = new Set<string>();
    const readbackIdentity = new Map<
      string,
      { itemId: string; documentId: string }
    >();
    const pageOffsets: number[] = [];
    let offset = 0;
    while (true) {
      pageOffsets.push(offset);
      const page = await asUser(OWNER, () =>
        getDatabase.run({ databaseId, limit: 37, offset }),
      );
      if (!("items" in page) || !page.pagination)
        throw new Error("Roadmap projection readback was unavailable.");
      expect(page.pagination.offset).toBe(offset);
      expect(page.pagination.returnedItems).toBe(page.items.length);
      expect(page.pagination.totalItems).toBe(124);
      for (const item of page.items) {
        const keyProperty = item.properties.find(
          (property) => property.definition.id === keyPropertyId,
        );
        if (typeof keyProperty?.value !== "string")
          throw new Error("Projected row is missing its Capability ID.");
        expect(readbackIds.has(keyProperty.value)).toBe(false);
        readbackIds.add(keyProperty.value);
        readbackIdentity.set(keyProperty.value, {
          itemId: item.id,
          documentId: item.document.id,
        });
      }
      if (!page.pagination.hasMore) break;
      expect(page.items.length).toBeGreaterThan(0);
      offset += page.items.length;
    }

    expect(pageOffsets).toEqual([0, 37, 74, 111]);
    expect(readbackIds).toEqual(
      new Set(capabilities.map((capability) => capability.id)),
    );
    expect(readbackIdentity).toEqual(firstReceipts);

    const uniqueRoot = await asUser(OWNER, () =>
      searchDocuments.run({
        exactTitle: PROJECTION_TITLE,
        parentId: null,
        spaceId: provisioned.personalSpaceId,
        documentType: "database",
        limit: 10,
        offset: 0,
      }),
    );
    expect(uniqueRoot).toMatchObject({
      documents: [{ id: databaseDocumentId }],
      pagination: {
        totalItems: 1,
        returnedItems: 1,
        hasMore: false,
        nextOffset: null,
      },
    });
    const outsiderRoot = await asUser(OUTSIDER, () =>
      searchDocuments.run({
        exactTitle: PROJECTION_TITLE,
        parentId: null,
        spaceId: provisioned.personalSpaceId,
        documentType: "database",
        limit: 10,
        offset: 0,
      }),
    );
    expect(outsiderRoot.pagination.totalItems).toBe(0);
    await expect(
      asUser(OUTSIDER, () => getDatabase.run({ databaseId, limit: 1 })),
    ).rejects.toThrow();

    const [rootDocument] = await getDb()
      .select({
        ownerEmail: schema.documents.ownerEmail,
        visibility: schema.documents.visibility,
      })
      .from(schema.documents)
      .where(eq(schema.documents.id, databaseDocumentId));
    expect(rootDocument).toEqual({
      ownerEmail: OWNER,
      visibility: "private",
    });
  }, 240_000);
});
