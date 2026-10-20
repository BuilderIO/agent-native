import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { resolve } from "node:path";

import { serializeIconValue } from "@agent-native/core/icons";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  migrateHistoricalIconUrls,
  findLiveCalloutIconOccurrences,
  type IconReference,
  type RehostReceipt,
} from "./migrate-historical-icon-urls.js";

vi.mock("../server/lib/private-icon-authority.js", () => ({
  assertPrivateIconOwner: vi.fn(async () => undefined),
  uploadPrivateIcon: vi.fn(),
  readPrivateIcon: vi.fn(),
}));

const databasePath = resolve(
  process.cwd(),
  "../../.tmp",
  `historical-icon-apply-${process.pid}-${Date.now()}.pglite`,
);
let getDb: typeof import("../server/db/index.js").getDb;
let schema: typeof import("../server/db/schema.js");
let replace: typeof import("./historical-icon-apply.js").replaceHistoricalIconIfUnchanged;
let openReceipts: typeof import("./historical-icon-apply.js").openHistoricalIconReceipts;
const ownerEmail = "owner@example.com";
const oldRaw = JSON.stringify({
  version: 1,
  kind: "image",
  authority: "url",
  assetId: "https://cdn.builder.io/api/v1/image/example",
});
const newRaw = JSON.stringify({
  version: 1,
  kind: "image",
  authority: "private-icon",
  assetId: "00000000-0000-4000-8000-000000000001",
});

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${databasePath}`;
  ({ getDb, schema } = await import("../server/db/index.js"));
  ({ replaceHistoricalIconIfUnchanged: replace } =
    await import("./historical-icon-apply.js"));
  ({ openHistoricalIconReceipts: openReceipts } =
    await import("./historical-icon-apply.js"));
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);
}, 60000);

afterAll(() => {
  if (databasePath.includes("/.tmp/") || databasePath.includes("\\.tmp\\")) {
    rmSync(databasePath, { recursive: true, force: true });
  }
});

describe("historical icon CAS and reference index", () => {
  it("migrates sibling live callouts atomically without changing fenced examples or unrelated body bytes", async () => {
    const db = getDb();
    const callout = `<callout icon="${oldRaw.replace(/"/g, "&quot;")}">\n\tKeep this prose.\n</callout>`;
    const fenced = `\`\`\`md\n${callout}\n\`\`\`\n`;
    const content = `${fenced}${callout}\n${callout}\n`;
    const documentId = "historical-callout-siblings";
    await db.insert(schema.documents).values({
      id: documentId,
      title: "Callouts",
      content,
      ownerEmail,
      orgId: null,
    });
    const references: IconReference[] = findLiveCalloutIconOccurrences(
      content,
    ).map((occurrence, calloutIndex) => ({
      table: "documents",
      rowId: documentId,
      path: `content.callouts[${calloutIndex}].icon`,
      raw: occurrence.raw,
      ownerEmail,
      orgId: null,
      contentRaw: content,
      calloutIndex,
    }));
    const data = Uint8Array.of(1, 2, 3);
    const sha256 = createHash("sha256").update(data).digest("hex");
    const receipts = new Map<string, RehostReceipt>();
    const uploadPrivate = vi.fn(async () => ({
      id: "00000000-0000-4000-8000-000000000001",
      sha256,
    }));
    const report = await migrateHistoricalIconUrls(
      {
        listReferences: async () => references,
        verifyBuilderOwnership: async () => "owned",
        fetchImage: async () => ({ data, mimeType: "image/png" }),
        uploadPrivate,
        readPrivate: async () => ({ data, sha256 }),
        readReceipt: async (key) => receipts.get(key) ?? null,
        saveReceipt: async (receipt) => {
          receipts.set(receipt.sourceFingerprint, receipt);
        },
        replaceIfUnchanged: replace,
      },
      { apply: true },
    );
    expect(report).toMatchObject({ migrated: 2, deferred: [] });
    expect(uploadPrivate).toHaveBeenCalledTimes(1);
    const [stored] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));
    const changedCallout = callout.replace(
      oldRaw.replace(/"/g, "&quot;"),
      serializeIconValue(JSON.parse(newRaw))!.replace(/"/g, "&quot;"),
    );
    expect(stored.content).toBe(
      `${fenced}${changedCallout}\n${changedCallout}\n`,
    );
    expect(stored.bodyRevision).toBe(2);
    const indexed = await db
      .select()
      .from(schema.privateIconReferences)
      .where(eq(schema.privateIconReferences.documentId, documentId));
    expect(indexed).toMatchObject([
      {
        elementType: "callout",
        assetId: "00000000-0000-4000-8000-000000000001",
      },
    ]);
    expect(await replace(references[0], newRaw)).toBe(false);
  });

  it("preserves concurrent edits and rolls back body changes when callout ownership verification fails", async () => {
    const db = getDb();
    const documentId = "historical-callout-cas";
    const content = `<callout icon="${oldRaw.replace(/"/g, "&quot;")}">\n\tOriginal\n</callout>`;
    await db.insert(schema.documents).values({
      id: documentId,
      title: "CAS",
      content,
      ownerEmail,
      orgId: null,
    });
    const reference: IconReference = {
      table: "documents",
      rowId: documentId,
      path: "content.callouts[0].icon",
      raw: oldRaw,
      ownerEmail,
      orgId: null,
      contentRaw: content,
      calloutIndex: 0,
    };
    await db
      .update(schema.documents)
      .set({ content: `${content}\nConcurrent edit` })
      .where(eq(schema.documents.id, documentId));
    expect(await replace(reference, newRaw)).toBe(false);
    await db
      .update(schema.documents)
      .set({ content })
      .where(eq(schema.documents.id, documentId));
    const { assertPrivateIconOwner } =
      await import("../server/lib/private-icon-authority.js");
    vi.mocked(assertPrivateIconOwner)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("unavailable"));
    await expect(replace(reference, newRaw)).rejects.toThrow("unavailable");
    const [stored] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));
    expect(stored.content).toBe(content);
    expect(stored.bodyRevision).toBe(0);
    expect(
      await db
        .select()
        .from(schema.privateIconReferences)
        .where(eq(schema.privateIconReferences.documentId, documentId)),
    ).toEqual([]);
  });

  it("replaces a current document icon and indexes it in the same transaction", async () => {
    const db = getDb();
    await db.insert(schema.documents).values({
      id: "historical-icon-doc",
      title: "Example",
      content: "",
      ownerEmail,
      orgId: null,
    });
    await db
      .update(schema.documents)
      .set({ icon: oldRaw })
      .where(eq(schema.documents.id, "historical-icon-doc"));
    const reference = {
      table: "documents" as const,
      rowId: "historical-icon-doc",
      path: "icon",
      raw: oldRaw,
      ownerEmail,
      orgId: null,
    };
    expect(await replace(reference, newRaw)).toBe(true);
    expect(await replace(reference, newRaw)).toBe(false);
    const [document] = await db
      .select({ icon: schema.documents.icon })
      .from(schema.documents)
      .where(eq(schema.documents.id, "historical-icon-doc"));
    expect(document.icon).toBe(newRaw);
    const indexed = await db
      .select()
      .from(schema.privateIconReferences)
      .where(eq(schema.privateIconReferences.elementId, "historical-icon-doc"));
    expect(indexed).toMatchObject([
      {
        elementType: "document",
        assetId: "00000000-0000-4000-8000-000000000001",
        documentId: "historical-icon-doc",
      },
    ]);
  });

  it("keeps unrelated view config and indexes property and view replacements", async () => {
    const db = getDb();
    const viewIcon = JSON.parse(oldRaw) as unknown;
    const viewConfigRaw = JSON.stringify({
      views: [{ id: "view-1", icon: viewIcon, name: "Table" }],
      layout: "grid",
    });
    await db.insert(schema.contentDatabases).values({
      id: "historical-icon-db",
      documentId: "historical-icon-doc",
      ownerEmail,
      orgId: null,
      viewConfigJson: viewConfigRaw,
    });
    await db.insert(schema.documentPropertyDefinitions).values({
      id: "historical-icon-property",
      databaseId: "historical-icon-db",
      ownerEmail,
      orgId: null,
      name: "Status",
      type: "text",
      icon: oldRaw,
    });
    expect(
      await replace(
        {
          table: "document_property_definitions",
          rowId: "historical-icon-property",
          path: "icon",
          raw: oldRaw,
          ownerEmail,
          orgId: null,
        },
        newRaw,
      ),
    ).toBe(true);
    expect(
      await replace(
        {
          table: "content_databases",
          rowId: "historical-icon-db",
          path: "views[0].icon",
          raw: JSON.stringify(viewIcon),
          ownerEmail,
          orgId: null,
          viewId: "view-1",
          viewConfigRaw,
        },
        newRaw,
      ),
    ).toBe(true);
    const [database] = await db
      .select({ viewConfigJson: schema.contentDatabases.viewConfigJson })
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, "historical-icon-db"));
    expect(JSON.parse(database.viewConfigJson)).toMatchObject({
      layout: "grid",
      views: [{ id: "view-1", name: "Table", icon: JSON.parse(newRaw) }],
    });
    const refs = await db.select().from(schema.privateIconReferences);
    expect(refs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          elementType: "property",
          elementId: "historical-icon-property",
          documentId: "historical-icon-doc",
        }),
        expect.objectContaining({
          elementType: "view",
          elementId: "historical-icon-db:view-1",
          documentId: "historical-icon-doc",
        }),
      ]),
    );
  });

  it("reuses a saved receipt after reopening the store", async () => {
    const filename = resolve(
      process.cwd(),
      "../../.tmp",
      `historical-icon-receipt-${process.pid}.json`,
    );
    const receipt = {
      sourceFingerprint: "example-source",
      sourceSha256: "example-source-sha",
      privateAssetId: "00000000-0000-4000-8000-000000000001",
      privateSha256: "example-private-sha",
      ownerEmail,
      orgId: null,
    };
    try {
      const first = await openReceipts(filename);
      await first.save(receipt);
      await first.close();
      const resumed = await openReceipts(filename);
      expect(resumed.read(receipt.sourceFingerprint, ownerEmail, null)).toEqual(
        receipt,
      );
      await resumed.close();
    } finally {
      rmSync(filename, { force: true });
    }
  });

  it("migrates sibling view icons using the rolling whole-config CAS", async () => {
    const db = getDb();
    const icon = JSON.parse(oldRaw) as unknown;
    const viewConfigRaw = JSON.stringify({
      views: [
        { id: "view-a", icon, name: "One" },
        { id: "view-b", icon, name: "Two" },
      ],
      layout: "grid",
    });
    await db.insert(schema.contentDatabases).values({
      id: "historical-icon-db-siblings",
      documentId: "historical-icon-doc",
      ownerEmail,
      orgId: null,
      viewConfigJson: viewConfigRaw,
    });
    const references: IconReference[] = ["view-a", "view-b"].map(
      (viewId, index) => ({
        table: "content_databases",
        rowId: "historical-icon-db-siblings",
        path: `views[${index}].icon`,
        raw: JSON.stringify(icon),
        ownerEmail,
        orgId: null,
        viewId,
        viewConfigRaw,
      }),
    );
    const data = new Uint8Array([1, 2, 3]);
    const digest = createHash("sha256").update(data).digest("hex");
    const receipts = new Map<string, RehostReceipt>();
    const report = await migrateHistoricalIconUrls(
      {
        listReferences: async () => references,
        verifyBuilderOwnership: async () => "owned",
        fetchImage: async () => ({ data, mimeType: "image/png" }),
        uploadPrivate: async () => ({
          id: "00000000-0000-4000-8000-000000000001",
          sha256: digest,
        }),
        readPrivate: async () => ({ data, sha256: digest }),
        readReceipt: async (fingerprint) => receipts.get(fingerprint) ?? null,
        saveReceipt: async (receipt) => {
          receipts.set(receipt.sourceFingerprint, receipt);
        },
        replaceIfUnchanged: replace,
      },
      { apply: true },
    );
    expect(report).toMatchObject({ migrated: 2, deferred: [] });
    const [database] = await db
      .select({ viewConfigJson: schema.contentDatabases.viewConfigJson })
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, "historical-icon-db-siblings"));
    expect(
      JSON.parse(database.viewConfigJson).views.map(
        (view: { icon: unknown }) => view.icon,
      ),
    ).toEqual([JSON.parse(newRaw), JSON.parse(newRaw)]);
    const refs = await db
      .select()
      .from(schema.privateIconReferences)
      .where(
        eq(schema.privateIconReferences.documentId, "historical-icon-doc"),
      );
    expect(refs.map((ref) => ref.elementId)).toEqual(
      expect.arrayContaining([
        "historical-icon-db-siblings:view-a",
        "historical-icon-db-siblings:view-b",
      ]),
    );
  });
});
