import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { putOrgSetting, putSetting } from "@agent-native/core/settings";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

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
      createdAt: now,
      updatedAt: now,
    });
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
}, 60_000);

beforeEach(async () => {
  await getDb().delete(schema.documents);
  await setFlags({});
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

    await getDbExec().execute({
      sql: "UPDATE public.settings SET value = ? WHERE key = ?",
      args: ["null", WRITER],
    });
    await expect(gate.liveBodyWriterGate("switched")).rejects.toMatchObject({
      name: "FeatureFlagRulesError",
      code: "malformed",
    });
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
