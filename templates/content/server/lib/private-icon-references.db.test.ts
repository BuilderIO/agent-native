import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { serializeIconValue } from "@agent-native/core/icons";
import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const checkOwner = vi.hoisted(() => vi.fn());
vi.mock("./private-icon-authority.js", () => ({
  assertPrivateIconOwner: checkOwner,
}));
vi.mock("@agent-native/creative-context/server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/creative-context/server")
  >()),
  getGenerationCreativeContext: vi.fn(async () => null),
}));

const TEST_DB_PATH = join(
  tmpdir(),
  `content-private-icons-${process.pid}-${Date.now()}.pglite`,
);
const ASSET = "11111111-1111-4111-8111-111111111111";
const FORGED = "22222222-2222-4222-8222-222222222222";
const OWNER = "icon-owner@example.test";
const SHARED = "icon-shared@example.test";
const OTHER = "icon-other@example.test";

let db: ReturnType<typeof import("../db/index.js").getDb>;
let schema: typeof import("../db/schema.js");
let refs: typeof import("./private-icon-references.js");
let resolveEditablePrivateIconOrgId: typeof import("./private-icon-target.js").resolveEditablePrivateIconOrgId;
let updateDocumentAction: typeof import("../../actions/update-document.js").default;
let count = 0;

function icon(id = ASSET) {
  return serializeIconValue({
    version: 1,
    kind: "image",
    authority: "private-icon",
    assetId: id,
  })!;
}

async function document(
  options: {
    visibility?: "private" | "public";
    icon?: string | null;
    content?: string;
  } = {},
) {
  const id = `private-icon-doc-${++count}`;
  await db.insert(schema.documents).values({
    id,
    ownerEmail: OWNER,
    orgId: null,
    title: "Icon test",
    content: options.content ?? "",
    icon: options.icon ?? null,
    visibility: options.visibility ?? "private",
  });
  return id;
}

async function share(documentId: string) {
  await db.insert(schema.documentShares).values({
    id: `private-icon-share-${++count}`,
    resourceId: documentId,
    principalType: "user",
    principalId: SHARED,
    role: "viewer",
    createdBy: OWNER,
  });
}

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const module = await import("../db/index.js");
  db = module.getDb();
  schema = module.schema;
  refs = await import("./private-icon-references.js");
  resolveEditablePrivateIconOrgId = (await import("./private-icon-target.js"))
    .resolveEditablePrivateIconOrgId;
  updateDocumentAction = (await import("../../actions/update-document.js"))
    .default;
  const plugin = (await import("../plugins/db.js")).default;
  await plugin(undefined as never);
  checkOwner.mockImplementation(
    async ({
      assetId,
      ownerEmail,
    }: {
      assetId: string;
      ownerEmail: string;
    }) => {
      if (assetId !== ASSET || ownerEmail !== OWNER)
        throw new Error("Private icon is unavailable to this user.");
    },
  );
}, 60_000);

afterAll(() => rmSync(TEST_DB_PATH, { recursive: true, force: true }));

describe("private icon references", () => {
  it("uses the editable document's personal scope despite an active workspace session", async () => {
    const id = await document();
    await share(id);
    await expect(
      runWithRequestContext(
        { userEmail: OWNER, orgId: "active-workspace" },
        () => resolveEditablePrivateIconOrgId(id),
      ),
    ).resolves.toBeNull();
    await expect(
      runWithRequestContext(
        { userEmail: SHARED, orgId: "active-workspace" },
        () => resolveEditablePrivateIconOrgId(id),
      ),
    ).rejects.toThrow(/editor role/iu);
  });

  it("serves a live icon to its document owner and explicit viewer, but denies an outsider", async () => {
    const id = await document({ icon: icon() });
    await share(id);
    await refs.syncPrivateIconReference(db, {
      elementType: "document",
      elementId: id,
      documentId: id,
      icon: icon(),
      ownerEmail: OWNER,
      orgId: null,
    });
    await expect(
      refs.resolveReadablePrivateIcon(ASSET, { userEmail: OWNER }),
    ).resolves.toEqual({ orgId: null });
    await expect(
      refs.resolveReadablePrivateIcon(ASSET, { userEmail: SHARED }),
    ).resolves.toEqual({ orgId: null });
    await expect(
      refs.resolveReadablePrivateIcon(ASSET, { userEmail: OTHER }),
    ).resolves.toBeNull();
    await db
      .update(schema.documents)
      .set({ icon: null })
      .where(eq(schema.documents.id, id));
  });

  it("serves an icon on an actual public document without a session", async () => {
    const id = await document({ visibility: "public", icon: icon(FORGED) });
    await refs.syncPrivateIconReference(db, {
      elementType: "document",
      elementId: id,
      documentId: id,
      icon: icon(FORGED),
      ownerEmail: OWNER,
      orgId: null,
    });
    await expect(refs.resolveReadablePrivateIcon(FORGED, {})).resolves.toEqual({
      orgId: null,
    });
    await db
      .update(schema.documents)
      .set({ icon: null })
      .where(eq(schema.documents.id, id));
    await expect(
      refs.resolveReadablePrivateIcon(FORGED, {}),
    ).resolves.toBeNull();
  });

  it("rejects a forged assignment and preserves access through the remaining live reference", async () => {
    await expect(
      refs.verifyPrivateIconAssignment({
        icon: icon(FORGED),
        userEmail: OWNER,
        orgId: null,
      }),
    ).rejects.toThrow("unavailable");
    const first = await document({ icon: icon() });
    const second = await document({ icon: icon() });
    await share(second);
    for (const id of [first, second]) {
      await refs.syncPrivateIconReference(db, {
        elementType: "document",
        elementId: id,
        documentId: id,
        icon: icon(),
        ownerEmail: OWNER,
        orgId: null,
      });
    }
    await db
      .update(schema.documents)
      .set({ icon: null })
      .where(eq(schema.documents.id, first));
    await refs.syncPrivateIconReference(db, {
      elementType: "document",
      elementId: first,
      documentId: first,
      icon: null,
      ownerEmail: OWNER,
      orgId: null,
    });
    await expect(
      refs.resolveReadablePrivateIcon(ASSET, { userEmail: SHARED }),
    ).resolves.toEqual({ orgId: null });
    await db
      .update(schema.documents)
      .set({ icon: null })
      .where(eq(schema.documents.id, second));
    await expect(
      refs.resolveReadablePrivateIcon(ASSET, { userEmail: SHARED }),
    ).resolves.toBeNull();
  });

  it("rejects forged private IDs in the document action before creating a reference", async () => {
    const id = await document();
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run({ id, icon: icon(FORGED) }),
      ),
    ).rejects.toThrow("unavailable");
    const [stored] = await db
      .select({ icon: schema.documents.icon })
      .from(schema.documents)
      .where(eq(schema.documents.id, id));
    expect(stored.icon).toBeNull();
    await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({ id, icon: icon(ASSET) }),
    );
    await expect(
      refs.resolveReadablePrivateIcon(ASSET, { userEmail: OWNER }),
    ).resolves.toEqual({ orgId: null });
  });

  it("requires a real saved callout, ignoring a code-fenced lookalike", async () => {
    const stored = icon(FORGED).replace(/"/g, "&quot;");
    const id = await document({
      visibility: "public",
      content: `\`\`\`md\n<callout icon="${stored}">\n\tFake\n</callout>\n\`\`\``,
    });
    await db.insert(schema.privateIconReferences).values({
      elementType: "callout",
      elementId: `${id}:${FORGED}`,
      documentId: id,
      assetId: FORGED,
      ownerEmail: OWNER,
      orgId: null,
    });
    await expect(
      refs.resolveReadablePrivateIcon(FORGED, {}),
    ).resolves.toBeNull();
    await db
      .update(schema.documents)
      .set({ content: `<callout icon="${stored}">\n\tReal\n</callout>` })
      .where(eq(schema.documents.id, id));
    await expect(refs.resolveReadablePrivateIcon(FORGED, {})).resolves.toEqual({
      orgId: null,
    });
  });

  it("propagates unavailable ownership authority on assignment", async () => {
    checkOwner.mockRejectedValueOnce(
      new Error("Private icon authority unavailable"),
    );
    await expect(
      refs.verifyPrivateIconAssignment({
        icon: icon(),
        userEmail: OWNER,
        orgId: null,
      }),
    ).rejects.toThrow("authority unavailable");
  });
});
