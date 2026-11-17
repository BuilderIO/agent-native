import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
  fail: (message: string) => {
    throw new Error(message);
  },
}));

vi.mock("@agent-native/core/sharing", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/sharing")>();
  return {
    ...actual,
    assertAccess: vi.fn(async () => ({
      role: "editor",
      resource: {
        id: "design_revision_overflow",
        ownerEmail: "owner@example.com",
        orgId: null,
        visibility: "public",
      },
    })),
  };
});

vi.mock("./visual-edit-browser-request.js", () => ({
  isSameOriginVisualEditBrowserRequest: () => true,
}));

import {
  closeDbExec,
  getDbExec,
  getRuntimeDatabaseUrl,
  withMigrationRuntime,
} from "@agent-native/core/db";

import { runDesignMigrations } from "../server/plugins/db.js";
import acknowledgePendingAction from "./acknowledge-visual-edit-pending.js";
import getPendingAction from "./get-visual-edit-pending.js";
import publishPendingAction from "./publish-visual-edit-pending.js";

const publisherId = "11111111-1111-4111-8111-111111111111";

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "pglite:memory://");
  vi.stubEnv("DATABASE_URL_UNPOOLED", "pglite:memory://");
  vi.stubEnv("DESIGN_DATABASE_URL", "pglite:memory://");
  vi.stubEnv("DESIGN_DATABASE_URL_UNPOOLED", "pglite:memory://");

  expect(getRuntimeDatabaseUrl()).toBe("pglite:memory://");
  await withMigrationRuntime(() => runDesignMigrations({}));
});

afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
});

describe("visual-edit pending revision migration", () => {
  it("publishes and reads a Date.now() revision through the external API", async () => {
    const revision = Date.now();
    const prompt = "Update the Clips library heading.";

    await publishPendingAction.run(
      {
        designId: "design_revision_overflow",
        publisherId,
        revision,
        pending: {
          designId: "design_revision_overflow",
          pendingEditCount: 1,
          status: "ready",
          prompt,
        },
      },
      { caller: "frontend", requestHeaders: new Headers() },
    );

    const { rows: columns } = await getDbExec().execute({
      sql: `SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_name = 'design_visual_edit_pending'
              AND column_name IN ('revision', 'client_revision')`,
    });
    expect(
      Object.fromEntries(
        columns.map(({ column_name, data_type }) => [column_name, data_type]),
      ),
    ).toMatchObject({ revision: "bigint", client_revision: "bigint" });

    const { rows: stored } = await getDbExec().execute({
      sql: `SELECT revision, client_revision
            FROM design_visual_edit_pending
            WHERE design_id = 'design_revision_overflow'`,
    });
    expect(stored[0]).toMatchObject({ revision: 1, client_revision: revision });

    await expect(
      getPendingAction.run({ designId: "design_revision_overflow" }),
    ).resolves.toMatchObject({
      designId: "design_revision_overflow",
      pendingEditCount: 1,
      status: "ready",
      prompt,
      revision: 1,
      clientRevision: revision,
      publisherId,
    });

    await expect(
      acknowledgePendingAction.run({
        designId: "design_revision_overflow",
        revision: 1,
      }),
    ).resolves.toMatchObject({ status: "empty", revision: 1 });
    await expect(
      getPendingAction.run({ designId: "design_revision_overflow" }),
    ).resolves.toMatchObject({
      status: "empty",
      revision: 1,
      clientRevision: revision,
      publisherId,
    });
  });

  it("reads legacy-worker writes from the same widened revision column", async () => {
    await publishPendingAction.run(
      {
        designId: "design_legacy_worker_revision",
        revision: 1,
        pending: {
          designId: "design_legacy_worker_revision",
          pendingEditCount: 1,
          status: "ready",
          prompt: "Keep this handoff available across a rolling deploy.",
        },
      },
      { caller: "frontend", requestHeaders: new Headers() },
    );

    await getDbExec().execute({
      sql: `UPDATE design_visual_edit_pending
            SET revision = 1750000000000
            WHERE design_id = 'design_legacy_worker_revision'`,
    });

    await expect(
      getPendingAction.run({ designId: "design_legacy_worker_revision" }),
    ).resolves.toMatchObject({ revision: 1750000000000 });
  });
});

describe("visual-edit handoff records", () => {
  const tweakRecord = (key: string, value: string | number) => ({
    kind: "tweak" as const,
    key,
    value,
    prompt: `- ${key}: ${JSON.stringify(value)}`,
  });

  async function publish(
    designId: string,
    revision: number,
    records: ReturnType<typeof tweakRecord>[],
    publisher = publisherId,
  ) {
    return publishPendingAction.run(
      {
        designId,
        publisherId: publisher,
        revision,
        pending: {
          designId,
          pendingEditCount: records.length,
          status: "ready",
          prompt: records.map((record) => record.prompt).join("\n"),
          records,
        },
      },
      { caller: "frontend", requestHeaders: new Headers() },
    );
  }

  async function seedDesign(designId: string, baseline: object) {
    await getDbExec().execute({
      sql: `INSERT INTO designs (id, title, data, owner_email, visibility)
            VALUES ($1, 'Handoff', $2, 'owner@example.com', 'private')`,
      args: [designId, JSON.stringify({ tweakSourceBaseline: baseline })],
    });
  }

  async function readBaseline(designId: string) {
    const { rows } = await getDbExec().execute({
      sql: `SELECT data FROM designs WHERE id = $1`,
      args: [designId],
    });
    return JSON.parse(String(rows[0]?.data)).tweakSourceBaseline;
  }

  it("advances only tweaks recorded in the acknowledged revision with the same value", async () => {
    const designId = "design_ack_records";
    await seedDesign(designId, { speed: 1 });
    const published = await publish(designId, 1, [
      tweakRecord("speed", 3),
      tweakRecord("gap", 8),
    ]);

    await expect(
      acknowledgePendingAction.run({
        designId,
        revision: published.revision ?? 0,
        appliedTweaks: [
          { id: "speed", value: 3 },
          { id: "gap", value: 12 },
          { id: "color", value: "red" },
        ],
      }),
    ).resolves.toMatchObject({
      status: "empty",
      tweakAcknowledgedCount: 1,
      notAcknowledgedTweaks: [
        { id: "gap", value: 12 },
        { id: "color", value: "red" },
      ],
    });
    expect(await readBaseline(designId)).toEqual({ speed: 3 });
  });

  it("acknowledges no tweak against a stale revision", async () => {
    const designId = "design_ack_stale";
    await seedDesign(designId, {});
    const first = await publish(designId, 1, [tweakRecord("speed", 3)]);
    await publish(designId, 2, [tweakRecord("speed", 4)]);

    await expect(
      acknowledgePendingAction.run({
        designId,
        revision: first.revision ?? 0,
        appliedTweaks: [{ id: "speed", value: 3 }],
      }),
    ).resolves.toMatchObject({
      status: "stale",
      tweakAcknowledgedCount: 0,
      notAcknowledgedTweaks: [{ id: "speed", value: 3 }],
    });
    expect(await readBaseline(designId)).toEqual({});
  });

  it("returns each published record so a later handoff can recompose it", async () => {
    const designId = "design_records_roundtrip";
    const records = [tweakRecord("speed", 3)];
    await publish(designId, 1, records);

    await expect(getPendingAction.run({ designId })).resolves.toMatchObject({
      status: "ready",
      records,
    });
  });

  it("lets the same publisher session replace its own waiting handoff but refuses another publisher", async () => {
    const designId = "design_same_publisher";
    await publish(designId, 1, [tweakRecord("speed", 3)]);
    await expect(
      publish(designId, 2, [tweakRecord("speed", 4)]),
    ).resolves.toMatchObject({ status: "ready", revision: 2 });
    await expect(
      publish(
        designId,
        1,
        [tweakRecord("speed", 5)],
        "22222222-2222-4222-8222-222222222222",
      ),
    ).rejects.toThrow(/Another collaborator/);
    await expect(getPendingAction.run({ designId })).resolves.toMatchObject({
      records: [tweakRecord("speed", 4)],
    });
  });
});
