import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec, type DbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { putOrgSetting, putSetting } from "@agent-native/core/settings";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-live-body-writer-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "live-body-owner@example.com";
const COLLABORATOR = "live-body-collaborator@example.com";
const ORG = "live-body-org";
const SHADOW = "feature-flag:content.live-body-shadow";
const WRITER = "feature-flag:content.live-body-writer";

let getDb: typeof import("../db/index.js").getDb;
let schema: typeof import("../db/schema.js");
let gate: typeof import("./live-body-writer.js");
let bodyRevision: typeof import("./document-body-revision.js");
let collab: typeof import("@agent-native/core/collab");

function rules(targets: { emails?: string[]; orgIds?: string[] }) {
  return {
    version: 1,
    mode: "rules",
    emails: targets.emails ?? [],
    orgIds: targets.orgIds ?? [],
    percentage: 0,
    updatedAt: null,
    updatedBy: null,
  };
}

async function setFlags(values: {
  shadow?: { emails?: string[]; orgIds?: string[] };
  writer?: { emails?: string[]; orgIds?: string[] };
}) {
  await putSetting(SHADOW, rules(values.shadow ?? {}));
  await putSetting(WRITER, rules(values.writer ?? {}));
}

async function insertPage(
  id: string,
  page: {
    switched?: boolean;
    bodyRevision?: number;
    collabBodyRevision?: number | null;
    liveCopyVersion?: number | null;
    orgId?: string | null;
  } = {},
) {
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.documents)
    .values({
      id,
      ownerEmail: OWNER,
      orgId: page.orgId ?? null,
      title: id,
      content: "Body",
      bodyRevision: page.bodyRevision ?? 3,
      collabBodyRevision:
        page.collabBodyRevision === undefined ? 3 : page.collabBodyRevision,
      liveBodySwitchedAt: page.switched === false ? null : now,
      liveCopyVersion:
        page.liveCopyVersion === undefined ? 0 : page.liveCopyVersion,
      createdAt: now,
      updatedAt: now,
    });
  // Its collab doc, created at version 0.
  await collab.saveYDocState(id, Y.encodeStateAsUpdate(new Y.Doc()), "Body");
}

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  const plugin = (await import("../plugins/db.js")).default;
  await plugin(undefined as never);
  const { registerFeatureFlags } =
    await import("@agent-native/core/feature-flags");
  const { CONTENT_FEATURE_FLAGS } =
    await import("../../shared/feature-flags.js");
  registerFeatureFlags(CONTENT_FEATURE_FLAGS);
  gate = await import("./live-body-writer.js");
  bodyRevision = await import("./document-body-revision.js");
  collab = await import("@agent-native/core/collab");
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS org_members (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL,
    joined_at BIGINT NOT NULL,
    federation_removal_pending_at BIGINT
  )`);
}, 60_000);

async function joinOrg(email: string, orgId: string) {
  await getDbExec().execute({
    sql: "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES (?, ?, ?, ?, ?)",
    args: [`${orgId}:${email}`, orgId, email, "owner", Date.now()],
  });
}

beforeEach(async () => {
  await getDb().delete(schema.documents);
  await getDbExec()
    .execute("DELETE FROM _collab_docs")
    .catch((error) => {
      // The first test runs before core creates the table.
      if (!/_collab_docs" does not exist/.test(String(error))) throw error;
    });
  await getDbExec().execute("DELETE FROM org_members");
  // Global rules first: the settings table is created by its first write.
  await setFlags({});
  await getDbExec().execute("DELETE FROM public.settings WHERE key LIKE 'o:%'");
});

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

describe("live-body writer gate", () => {
  it("takes the live copy only for a switched, current page with both flags on for its owner", async () => {
    await setFlags({
      shadow: { emails: [OWNER] },
      writer: { emails: [OWNER] },
    });
    await insertPage("switched");
    await insertPage("unswitched", { switched: false });

    await expect(gate.liveBodyWriterGate("switched")).resolves.toEqual({
      writePath: "live_copy",
    });
    await expect(gate.isLiveBodyWriterPage("switched")).resolves.toBe(true);
    await expect(gate.liveBodyWriterGate("unswitched")).resolves.toEqual({
      writePath: "legacy",
      reason: "not_switched",
    });
    await expect(gate.liveBodyWriterGate("missing")).resolves.toEqual({
      writePath: "legacy",
      reason: "no_page",
    });
  });

  it("needs the shadow flag too, so turning the shadow flag on alone switches nobody", async () => {
    await insertPage("switched");

    await setFlags({ shadow: { emails: [OWNER] } });
    await expect(gate.liveBodyWriterGate("switched")).resolves.toEqual({
      writePath: "legacy",
      reason: "flag_off",
    });

    await setFlags({ writer: { emails: [OWNER] } });
    await expect(gate.liveBodyWriterGate("switched")).resolves.toEqual({
      writePath: "legacy",
      reason: "flag_off",
    });
  });

  it("evaluates the flags for the page, whoever is calling", async () => {
    await insertPage("switched");
    await setFlags({
      shadow: { emails: [COLLABORATOR] },
      writer: { emails: [COLLABORATOR] },
    });

    await expect(
      runWithRequestContext({ userEmail: COLLABORATOR }, () =>
        gate.liveBodyWriterGate("switched"),
      ),
    ).resolves.toEqual({ writePath: "legacy", reason: "flag_off" });

    await setFlags({
      shadow: { emails: [OWNER] },
      writer: { emails: [OWNER] },
    });
    await expect(
      runWithRequestContext({ userEmail: COLLABORATOR }, () =>
        gate.liveBodyWriterGate("switched"),
      ),
    ).resolves.toEqual({ writePath: "live_copy" });
  });

  it("follows an organization rollout for the page's organization", async () => {
    await insertPage("org-page", { orgId: ORG });
    await insertPage("personal-page");
    await joinOrg(OWNER, ORG);
    await putOrgSetting(ORG, SHADOW, rules({ orgIds: [ORG] }));
    await putOrgSetting(ORG, WRITER, rules({ orgIds: [ORG] }));

    await expect(gate.liveBodyWriterGate("org-page")).resolves.toEqual({
      writePath: "live_copy",
    });
    await expect(gate.liveBodyWriterGate("personal-page")).resolves.toEqual({
      writePath: "legacy",
      reason: "flag_off",
    });
  });

  it("switches an owner's personal pages on their own enablement in one of their orgs, whoever is calling", async () => {
    await insertPage("personal-page");
    await joinOrg(OWNER, ORG);
    await joinOrg(COLLABORATOR, ORG);
    // What enable-for-current-user stores for a manager whose active org is ORG.
    await putOrgSetting(ORG, SHADOW, rules({ emails: [OWNER] }));
    await putOrgSetting(ORG, WRITER, rules({ emails: [OWNER] }));

    await expect(
      runWithRequestContext({ userEmail: COLLABORATOR, orgId: ORG }, () =>
        gate.liveBodyWriterGate("personal-page"),
      ),
    ).resolves.toEqual({ writePath: "live_copy" });

    // A collaborator's own enablement does not switch the owner's page.
    await putOrgSetting(ORG, SHADOW, rules({ emails: [COLLABORATOR] }));
    await putOrgSetting(ORG, WRITER, rules({ emails: [COLLABORATOR] }));
    await expect(gate.liveBodyWriterGate("personal-page")).resolves.toEqual({
      writePath: "legacy",
      reason: "flag_off",
    });

    // Nor does the owner's listing in an org they have left.
    await putOrgSetting(ORG, SHADOW, rules({ emails: [OWNER] }));
    await putOrgSetting(ORG, WRITER, rules({ emails: [OWNER] }));
    await getDbExec().execute({
      sql: "UPDATE org_members SET federation_removal_pending_at = ? WHERE email = ?",
      args: [Date.now(), OWNER],
    });
    await expect(gate.liveBodyWriterGate("personal-page")).resolves.toEqual({
      writePath: "legacy",
      reason: "flag_off",
    });
  });

  it("keeps a switched page on the legacy path once a legacy write has moved its body past the live copy", async () => {
    await setFlags({
      shadow: { emails: [OWNER] },
      writer: { emails: [OWNER] },
    });
    await insertPage("behind", { bodyRevision: 4, collabBodyRevision: 3 });
    await insertPage("never-synced", { collabBodyRevision: null });

    await expect(gate.liveBodyWriterGate("behind")).resolves.toEqual({
      writePath: "legacy",
      reason: "live_copy_behind",
    });
    await expect(gate.liveBodyWriterGate("never-synced")).resolves.toEqual({
      writePath: "legacy",
      reason: "live_copy_behind",
    });
  });

  it("keeps a switched page on the legacy path once its live copy has moved past the stored body", async () => {
    await setFlags({
      shadow: { emails: [OWNER] },
      writer: { emails: [OWNER] },
    });
    await insertPage("moved", { liveCopyVersion: 0 });
    await insertPage("never-derived", { liveCopyVersion: null });
    // An editor update committed on main's path while the flags were off.
    await collab.saveYDocState(
      "moved",
      Y.encodeStateAsUpdate(new Y.Doc()),
      "Body",
    );

    await expect(gate.liveBodyWriterGate("moved")).resolves.toEqual({
      writePath: "legacy",
      reason: "stored_body_behind",
    });
    await expect(gate.liveBodyWriterGate("never-derived")).resolves.toEqual({
      writePath: "legacy",
      reason: "stored_body_behind",
    });
    await getDbExec().execute({
      sql: "DELETE FROM _collab_docs WHERE doc_id = ?",
      args: ["moved"],
    });
    await expect(gate.liveBodyWriterGate("moved")).resolves.toEqual({
      writePath: "legacy",
      reason: "stored_body_behind",
    });
  });

  it("fails loudly on malformed flag state for a switched page instead of reading it as off", async () => {
    await setFlags({
      shadow: { emails: [OWNER] },
      writer: { emails: [OWNER] },
    });
    await insertPage("switched");
    await insertPage("unswitched", { switched: false });
    await putSetting(WRITER, { version: 1, mode: "onn" });

    await expect(gate.liveBodyWriterGate("switched")).rejects.toMatchObject({
      name: "FeatureFlagRulesError",
      code: "malformed",
    });
    await expect(gate.liveBodyWriterGate("unswitched")).resolves.toEqual({
      writePath: "legacy",
      reason: "not_switched",
    });

    for (const stored of ["null", "{", JSON.stringify({ mode: "on" })]) {
      await getDbExec().execute({
        sql: "UPDATE public.settings SET value = ? WHERE key = ?",
        args: [stored, WRITER],
      });
      await expect(gate.liveBodyWriterGate("switched")).rejects.toMatchObject({
        name: "FeatureFlagRulesError",
        code: "malformed",
      });
    }
  });

  it("reads the flags in the caller's transaction rather than the request's settings snapshot", async () => {
    await setFlags({
      shadow: { emails: [OWNER] },
      writer: { emails: [OWNER] },
    });
    await insertPage("switched");

    await runWithRequestContext({ userEmail: COLLABORATOR }, async () => {
      await expect(gate.liveBodyWriterGate("switched")).resolves.toEqual({
        writePath: "live_copy",
      });

      await getDb().transaction(async (tx) => {
        const [row] = await tx
          .select(gate.liveBodyWriterPageColumns)
          .from(schema.documents)
          .where(eq(schema.documents.id, "switched"))
          .for("update");
        // Turned off inside this transaction, so only a read in it can see the
        // change; a request of its own leaves this request's snapshot stale.
        await runWithRequestContext({}, () =>
          setFlags({ shadow: { emails: [OWNER] } }),
        );
        await expect(gate.liveBodyWriterGateForRow(row)).resolves.toEqual({
          writePath: "live_copy",
        });
        await expect(
          gate.liveBodyWriterGateForRow(row, { transaction: getDbExec() }),
        ).resolves.toEqual({ writePath: "legacy", reason: "flag_off" });
      });
    });
  });
});

describe("lockLegacyBodyWrites", () => {
  const WRITER_FLAGS = {
    shadow: { emails: [OWNER] },
    writer: { emails: [OWNER] },
  };

  async function body(id: string) {
    const [row] = await getDb()
      .select({
        content: schema.documents.content,
        bodyRevision: schema.documents.bodyRevision,
      })
      .from(schema.documents)
      .where(eq(schema.documents.id, id));
    return row;
  }

  async function write(
    ids: string[],
    content: string,
    options: {
      operation: string;
      routed?: boolean;
      instead?: string;
      content?: string;
    } = {
      operation: "test-writer",
    },
  ) {
    await getDb().transaction(async (tx) => {
      const legacy = await bodyRevision.lockLegacyBodyWrites(tx, ids, options);
      for (const id of ids) {
        await tx
          .update(schema.documents)
          .set({ content, bodyRevision: legacy.bodyRevision(content) })
          .where(eq(schema.documents.id, id));
      }
    });
  }

  it("bumps a legacy page's body revision only when its body changes", async () => {
    await setFlags(WRITER_FLAGS);
    await insertPage("legacy", { switched: false });

    await write(["legacy"], "New body");
    expect(await body("legacy")).toEqual({
      content: "New body",
      bodyRevision: 4,
    });
    await write(["legacy"], "New body");
    expect((await body("legacy")).bodyRevision).toBe(4);
  });

  it("refuses every page of a write when one takes body writes through its live copy", async () => {
    await setFlags(WRITER_FLAGS);
    await insertPage("legacy", { switched: false });
    await insertPage("switched");

    const refused = write(["legacy", "switched"], "New body", {
      operation: "test-writer",
      instead: "Write it some other way.",
    });

    await expect(refused).rejects.toMatchObject({
      errorCode: "LIVE_BODY_WRITER_UNSUPPORTED",
      statusCode: 409,
      details: { documentId: "switched", operation: "test-writer" },
      message: expect.stringMatching(
        /Retrying won't change that\. Write it some other way\.$/,
      ),
    });
    await expect(refused.catch((error) => error)).resolves.toSatisfy(
      bodyRevision.isUnsupportedBodyWriter,
    );
    expect(await body("legacy")).toEqual({ content: "Body", bodyRevision: 3 });
    expect(await body("switched")).toEqual({
      content: "Body",
      bodyRevision: 3,
    });
  });

  it("refuses a routed writer's page that switched in flight as retryable", async () => {
    await setFlags(WRITER_FLAGS);
    await insertPage("switched");

    await expect(
      write(["switched"], "New body", {
        operation: "test-writer",
        routed: true,
      }),
    ).rejects.toMatchObject({
      errorCode: "LIVE_BODY_WRITE_PATH_CHANGED",
      details: { documentId: "switched", reason: "live_copy" },
    });
    expect(await body("switched")).toEqual({
      content: "Body",
      bodyRevision: 3,
    });
  });

  it("reads the write path on the exec a raw transaction's writer passes", async () => {
    const { drizzleOverExec } = await import("../live-copy/exec-db.js");
    await setFlags(WRITER_FLAGS);
    await insertPage("switched");
    const reads: string[] = [];

    await expect(
      getDbExec().transaction!(async (exec) => {
        const recorded: DbExec = {
          execute: (statement) => {
            reads.push(
              typeof statement === "string" ? statement : statement.sql,
            );
            return exec.execute(statement);
          },
        };
        await bodyRevision.lockLegacyBodyWrites(
          drizzleOverExec(exec),
          ["switched"],
          { operation: "test-writer", routed: true, exec: recorded },
        );
      }),
    ).rejects.toMatchObject({ errorCode: "LIVE_BODY_WRITE_PATH_CHANGED" });
    expect(reads).toContainEqual(expect.stringContaining("_collab_docs"));
    expect(await body("switched")).toEqual({
      content: "Body",
      bodyRevision: 3,
    });
  });

  it("reads the live copies' versions and an owner's flags once, however many of their pages it locks", async () => {
    const { drizzleOverExec } = await import("../live-copy/exec-db.js");
    for (const id of ["a", "b", "c"]) await insertPage(id);
    async function readsFor(ids: string[]) {
      let reads = 0;
      await getDbExec().transaction!(async (exec) => {
        const recorded: DbExec = {
          execute: (statement) => {
            reads += 1;
            return exec.execute(statement);
          },
        };
        await bodyRevision.lockLegacyBodyWrites(drizzleOverExec(exec), ids, {
          operation: "test-writer",
          exec: recorded,
        });
      });
      return reads;
    }

    const onePage = await readsFor(["a"]);
    expect(onePage).toBeGreaterThan(1);
    expect(await readsFor(["a", "b", "c"])).toBe(onePage);
  });

  it("lets a one-body writer change a switched page's metadata when its body already reads that body", async () => {
    await setFlags(WRITER_FLAGS);
    await insertPage("switched");

    await getDb().transaction(async (tx) => {
      const legacy = await bodyRevision.lockLegacyBodyWrites(tx, ["switched"], {
        operation: "test-writer",
        content: "Body",
      });
      await tx
        .update(schema.documents)
        .set({
          title: "New title",
          content: "Body",
          bodyRevision: legacy.bodyRevision("Body"),
        })
        .where(eq(schema.documents.id, "switched"));
    });

    const [page] = await getDb()
      .select({ title: schema.documents.title })
      .from(schema.documents)
      .where(eq(schema.documents.id, "switched"));
    expect(page.title).toBe("New title");
    expect(await body("switched")).toEqual({
      content: "Body",
      bodyRevision: 3,
    });
    await expect(
      write(["switched"], "New body", {
        operation: "test-writer",
        content: "New body",
      }),
    ).rejects.toMatchObject({ errorCode: "LIVE_BODY_WRITER_UNSUPPORTED" });
  });

  it("lets a switched page take legacy writes while its flags are off (SF-11)", async () => {
    await insertPage("switched");

    await write(["switched"], "New body");

    expect(await body("switched")).toEqual({
      content: "New body",
      bodyRevision: 4,
    });
  });

  it("leaves a page that doesn't exist to the writer", async () => {
    await setFlags(WRITER_FLAGS);

    await expect(write(["missing"], "New body")).resolves.toBeUndefined();
  });

  it("refuses a page on its live copy up front, before a writer changes anything outside Content", async () => {
    await setFlags(WRITER_FLAGS);
    await insertPage("legacy", { switched: false });
    await insertPage("switched");

    await expect(
      bodyRevision.assertLegacyBodyWriter("legacy", { operation: "push" }),
    ).resolves.toBeUndefined();
    await expect(
      bodyRevision.assertLegacyBodyWriter("switched", { operation: "push" }),
    ).rejects.toMatchObject({
      errorCode: "LIVE_BODY_WRITER_UNSUPPORTED",
      details: { documentId: "switched", operation: "push" },
    });
  });
});
