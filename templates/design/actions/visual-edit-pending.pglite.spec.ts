import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const accessState = vi.hoisted(() => ({ role: "editor" }));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
  defineActionErrors: (...codes: string[]) => codes,
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
      role: accessState.role,
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
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";

import { runDesignMigrations } from "../server/plugins/db.js";
import {
  readTweakSelectionsRevision,
  tweakSelectionsHash,
} from "../shared/resolve-tweaks.js";
import acknowledgePendingAction from "./acknowledge-visual-edit-pending.js";
import applyTweaksAction from "./apply-tweaks.js";
import clearEditsAction from "./clear-edits.js";
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

beforeEach(() => {
  accessState.role = "editor";
});

afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
});

describe("visual-edit pending revision migration", () => {
  it("publishes and reads a Date.now() revision through the external API", async () => {
    const revision = Date.now();
    const prompt = "Update the Clips library heading.";
    await getDbExec().execute({
      sql: `INSERT INTO designs (id, title, data, owner_email, visibility)
            VALUES ($1, 'Handoff', $2, 'owner@example.com', 'private')`,
      args: ["design_revision_overflow", JSON.stringify({})],
    });

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
      tweakSelectionsRevision: 0,
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
    await getDbExec().execute({
      sql: `INSERT INTO designs (id, title, data, owner_email, visibility)
            VALUES ($1, 'Handoff', $2, 'owner@example.com', 'private')`,
      args: ["design_legacy_worker_revision", JSON.stringify({})],
    });
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
    ).resolves.toMatchObject({
      revision: 1750000000000,
      tweakSelectionsRevision: 0,
    });
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
    capabilitySessionId?: string,
  ) {
    await getDbExec().execute({
      sql: `INSERT INTO designs (id, title, data, owner_email, visibility)
            VALUES ($1, 'Handoff', $2, 'owner@example.com', 'private')
            ON CONFLICT (id) DO NOTHING`,
      args: [designId, JSON.stringify({ tweakSourceBaseline: {} })],
    });
    const publishAction = () =>
      publishPendingAction.run(
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
    return runWithRequestContext(
      {
        userEmail: "publisher@example.com",
        ...(capabilitySessionId
          ? {
              authCapability: `capability:visual-edit:design:${designId}`,
              capabilitySessionId,
            }
          : {}),
      },
      publishAction,
    );
  }

  async function seedDesign(designId: string, baseline: object) {
    await getDbExec().execute({
      sql: `INSERT INTO designs (id, title, data, owner_email, visibility)
            VALUES ($1, 'Handoff', $2, 'owner@example.com', 'private')`,
      args: [designId, JSON.stringify({ tweakSourceBaseline: baseline })],
    });
  }

  async function seedChangedTweaks(designId: string) {
    await getDbExec().execute({
      sql: `INSERT INTO designs (id, title, data, owner_email, visibility)
            VALUES ($1, 'Clear edits', $2, 'owner@example.com', 'private')`,
      args: [
        designId,
        JSON.stringify({
          tweakSourceBaseline: { accent: "#00dff6" },
          tweakSelections: { accent: "#1b7585", extra: true },
        }),
      ],
    });
  }

  async function readDesignData(designId: string) {
    const { rows } = await getDbExec().execute({
      sql: `SELECT data FROM designs WHERE id = $1`,
      args: [designId],
    });
    return JSON.parse(String(rows[0]?.data));
  }

  async function clearPendingEdits(
    args: {
      designId: string;
      revision?: number;
      publisherId?: string;
      expectedTweakSelectionsRevision?: number;
    },
    ctx?: Parameters<typeof clearEditsAction.run>[1],
  ) {
    const currentData = await readDesignData(args.designId);
    const expectedTweakSelectionsRevision =
      args.expectedTweakSelectionsRevision ??
      readTweakSelectionsRevision(currentData as Record<string, unknown>);
    if (expectedTweakSelectionsRevision === null) {
      throw new Error("Test design has an unreadable tweak revision.");
    }
    return clearEditsAction.run(
      { ...args, expectedTweakSelectionsRevision },
      ctx,
    );
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

  it("does not advance the tweak baseline from an unapproved suggestion", async () => {
    const designId = "design_ack_suggestion_tweak";
    await seedDesign(designId, { accent: "#00dff6" });
    accessState.role = "commenter";
    const published = await publish(designId, 1, [
      tweakRecord("accent", "#1b7585"),
    ]);
    accessState.role = "editor";

    await expect(
      acknowledgePendingAction.run({
        designId,
        revision: published.revision ?? 0,
        appliedTweaks: [{ id: "accent", value: "#1b7585" }],
      }),
    ).rejects.toThrow(/Suggested visual edits cannot advance/);
    expect(await readBaseline(designId)).toEqual({ accent: "#00dff6" });
    await expect(getPendingAction.run({ designId })).resolves.toMatchObject({
      status: "suggested",
      revision: published.revision,
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

  it("lets the same publisher undo and redo without allowing another author to reuse its ID", async () => {
    const designId = "design_same_publisher_undo_redo";
    const records = [tweakRecord("speed", 3)];
    await publish(designId, 1, records);

    await expect(
      runWithRequestContext({ userEmail: "publisher@example.com" }, () =>
        publishPendingAction.run(
          {
            designId,
            publisherId,
            revision: 2,
            pending: null,
          },
          { caller: "frontend", requestHeaders: new Headers() },
        ),
      ),
    ).resolves.toMatchObject({ status: "empty", pendingEditCount: 0 });

    await expect(
      runWithRequestContext({ userEmail: "other-editor@example.com" }, () =>
        publishPendingAction.run(
          {
            designId,
            publisherId,
            revision: 3,
            pending: {
              designId,
              pendingEditCount: 1,
              status: "ready",
              prompt: records[0].prompt,
              records,
            },
          },
          { caller: "frontend", requestHeaders: new Headers() },
        ),
      ),
    ).resolves.toMatchObject({ status: "stale" });

    await expect(publish(designId, 3, records)).resolves.toMatchObject({
      status: "ready",
      pendingEditCount: 1,
    });
  });

  it("does not let another editor clear a handoff by reusing its publisher ID", async () => {
    const designId = "design_reused_publisher_id";
    const published = await publish(designId, 1, [tweakRecord("speed", 3)]);

    await expect(
      runWithRequestContext({ userEmail: "other-editor@example.com" }, () =>
        publishPendingAction.run(
          {
            designId,
            publisherId,
            revision: 2,
            pending: null,
          },
          { caller: "frontend", requestHeaders: new Headers() },
        ),
      ),
    ).resolves.toMatchObject({
      status: "stale",
      revision: null,
      updatedAt: null,
    });
    await expect(getPendingAction.run({ designId })).resolves.toMatchObject({
      status: "ready",
      revision: published.revision,
      records: [tweakRecord("speed", 3)],
    });
  });

  it("lets an identity-less publisher update its own handoff but not an identified one", async () => {
    const designId = "design_anonymous_same_publisher";
    await seedDesign(designId, {});
    const records = [tweakRecord("speed", 3)];
    const anonymousPublish = (
      revision: number,
      pending: ReturnType<typeof tweakRecord>[] | null,
      targetDesignId = designId,
    ) =>
      publishPendingAction.run(
        {
          designId: targetDesignId,
          publisherId,
          revision,
          pending: pending && {
            designId: targetDesignId,
            pendingEditCount: pending.length,
            status: "ready",
            prompt: pending.map((record) => record.prompt).join("\n"),
            records: pending,
          },
        },
        { caller: "frontend", requestHeaders: new Headers() },
      );

    await expect(anonymousPublish(1, records)).resolves.toMatchObject({
      status: "ready",
      pendingEditCount: 1,
    });
    await expect(
      anonymousPublish(2, [tweakRecord("speed", 4)]),
    ).resolves.toMatchObject({ status: "ready", pendingEditCount: 1 });
    await expect(anonymousPublish(3, null)).resolves.toMatchObject({
      status: "empty",
      pendingEditCount: 0,
    });

    const identifiedDesignId = "design_identified_publisher";
    const published = await publish(identifiedDesignId, 1, records);
    await expect(
      anonymousPublish(2, null, identifiedDesignId),
    ).resolves.toMatchObject({ status: "stale" });
    await expect(
      getPendingAction.run({ designId: identifiedDesignId }),
    ).resolves.toMatchObject({
      status: "ready",
      revision: published.revision,
    });
  });

  it("allows the matching capability session to update its publisher ID", async () => {
    const designId = "design_capability_same_publisher";
    const publisherSessionId = "b".repeat(64);
    await publish(
      designId,
      1,
      [tweakRecord("speed", 3)],
      publisherId,
      publisherSessionId,
    );
    await getDbExec().execute({
      sql: `UPDATE design_visual_edit_pending SET author_email = NULL WHERE design_id = $1`,
      args: [designId],
    });

    await expect(
      runWithRequestContext(
        {
          authCapability: `capability:visual-edit:design:${designId}`,
          capabilitySessionId: publisherSessionId,
        },
        () =>
          publishPendingAction.run(
            {
              designId,
              publisherId,
              revision: 2,
              pending: {
                designId,
                pendingEditCount: 1,
                status: "ready",
                prompt: "- speed: 4",
                records: [tweakRecord("speed", 4)],
              },
            },
            { caller: "frontend", requestHeaders: new Headers() },
          ),
      ),
    ).resolves.toMatchObject({ status: "ready", revision: 2 });
    await expect(getPendingAction.run({ designId })).resolves.toMatchObject({
      records: [tweakRecord("speed", 4)],
    });
  });

  it("keeps a new capability session separate from the old session's handoff", async () => {
    const designId = "design_capability_session_rotation";
    const firstSession = "c".repeat(64);
    const nextSession = "d".repeat(64);
    await seedDesign(designId, { speed: 1 });
    const publishFromSession = (sessionId: string, revision: number) =>
      runWithRequestContext(
        {
          authCapability: `capability:visual-edit:design:${designId}`,
          capabilitySessionId: sessionId,
        },
        () =>
          publishPendingAction.run(
            {
              designId,
              publisherId,
              revision,
              pending: {
                designId,
                pendingEditCount: 1,
                status: "ready",
                prompt: "- speed: 3",
                records: [tweakRecord("speed", 3)],
              },
            },
            { caller: "frontend", requestHeaders: new Headers() },
          ),
      );

    const published = await publishFromSession(firstSession, 1);
    await getDbExec().execute({
      sql: `UPDATE design_visual_edit_pending SET author_email = NULL WHERE design_id = $1`,
      args: [designId],
    });
    await expect(
      runWithRequestContext(
        {
          authCapability: `capability:visual-edit:design:${designId}`,
          capabilitySessionId: nextSession,
        },
        () => getPendingAction.run({ designId }, { caller: "frontend" }),
      ),
    ).resolves.toMatchObject({ canClear: false });
    await expect(publishFromSession(nextSession, 2)).resolves.toMatchObject({
      status: "stale",
    });
    await expect(
      runWithRequestContext(
        {
          authCapability: `capability:visual-edit:design:${designId}`,
          capabilitySessionId: nextSession,
        },
        () =>
          clearPendingEdits({
            designId,
            revision: published.revision ?? 0,
            publisherId,
          }),
      ),
    ).rejects.toThrow(/handoff author or design owner/);

    accessState.role = "owner";
    await expect(
      clearPendingEdits({
        designId,
        revision: published.revision ?? 0,
        publisherId,
      }),
    ).resolves.toMatchObject({ cleared: true, handoffCleared: true });
  });

  it("clears the exact publisher revision and resets persisted tweaks to the source baseline", async () => {
    const designId = "design_clear_exact_revision";
    await seedChangedTweaks(designId);
    const published = await publish(designId, 3, [
      tweakRecord("accent", "#1b7585"),
    ]);
    accessState.role = "owner";

    await expect(
      clearPendingEdits({
        designId,
        revision: published.revision ?? 0,
        publisherId,
      }),
    ).resolves.toMatchObject({
      cleared: true,
      stale: false,
      revision: (published.revision ?? 0) + 1,
      resetTweakSelections: true,
      handoffCleared: true,
    });
    expect(await readDesignData(designId)).toMatchObject({
      tweakSourceBaseline: { accent: "#00dff6" },
      tweakSelections: { accent: "#00dff6" },
    });
    await expect(getPendingAction.run({ designId })).resolves.toMatchObject({
      status: "empty",
      prompt: "",
      records: [],
    });
    await getDbExec().execute({
      sql: `UPDATE designs SET data = $2 WHERE id = $1`,
      args: [
        designId,
        JSON.stringify({
          tweakSourceBaseline: { accent: "#00dff6" },
          tweakSelections: { accent: "#4a5568" },
        }),
      ],
    });
    await expect(
      clearPendingEdits({
        designId,
        revision: published.revision ?? 0,
        publisherId,
      }),
    ).resolves.toMatchObject({ stale: true, resetTweakSelections: false });
    expect(await readDesignData(designId)).toMatchObject({
      tweakSelections: { accent: "#4a5568" },
    });
  });

  it("refuses to clear tweak selections newer than the handoff snapshot", async () => {
    const designId = "design_clear_tweak_revision_conflict";
    await seedDesign(designId, { accent: "#00dff6" });
    await getDbExec().execute({
      sql: `UPDATE designs SET data = $2 WHERE id = $1`,
      args: [
        designId,
        JSON.stringify({
          tweakSourceBaseline: { accent: "#00dff6" },
          tweakSelections: { accent: "#00dff6" },
        }),
      ],
    });
    const published = await publish(designId, 1, [
      tweakRecord("accent", "#1b7585"),
    ]);
    const observed = await getPendingAction.run({ designId });
    expect(observed.tweakSelectionsRevision).toBe(0);

    await applyTweaksAction.run({
      designId,
      selections: { accent: "#155e6a" },
      expectedSelectionsHash: tweakSelectionsHash({ accent: "#00dff6" }),
    });

    await expect(
      clearPendingEdits(
        {
          designId,
          revision: published.revision ?? 0,
          publisherId,
          expectedTweakSelectionsRevision: observed.tweakSelectionsRevision!,
        },
        { caller: "tool", userEmail: "publisher@example.com" },
      ),
    ).resolves.toMatchObject({
      cleared: false,
      stale: true,
      resetTweakSelections: false,
      handoffCleared: false,
      handoffPending: true,
    });
    expect(await readDesignData(designId)).toMatchObject({
      tweakSelections: { accent: "#155e6a" },
      tweakSelectionsRevision: 1,
    });
    await expect(getPendingAction.run({ designId })).resolves.toMatchObject({
      status: "ready",
      revision: published.revision,
      tweakSelectionsRevision: 1,
    });

    await expect(
      clearPendingEdits(
        {
          designId,
          revision: published.revision ?? 0,
          publisherId,
          expectedTweakSelectionsRevision: 1,
        },
        { caller: "tool", userEmail: "publisher@example.com" },
      ),
    ).resolves.toMatchObject({ cleared: true, handoffCleared: true });
    expect(await readDesignData(designId)).toMatchObject({
      tweakSelections: { accent: "#00dff6" },
      tweakSelectionsRevision: 2,
    });
  });

  it("lets the design owner clear another publisher's exact handoff but not an editor", async () => {
    const designId = "design_clear_foreign_publisher";
    await seedChangedTweaks(designId);
    const foreignPublisher = "22222222-2222-4222-8222-222222222222";
    const published = await publish(
      designId,
      1,
      [tweakRecord("accent", "#1b7585")],
      foreignPublisher,
    );
    const args = {
      designId,
      revision: published.revision ?? 0,
      publisherId: foreignPublisher,
    };

    await expect(
      clearPendingEdits(
        { designId },
        { caller: "frontend", userEmail: "editor@example.com" },
      ),
    ).resolves.toMatchObject({
      cleared: false,
      resetTweakSelections: false,
      handoffCleared: false,
      handoffPending: true,
    });
    for (const caller of ["tool", "mcp"] as const) {
      await expect(
        clearPendingEdits(
          { designId },
          { caller, userEmail: "editor@example.com" },
        ),
      ).rejects.toThrow(/Read the current handoff/);
    }
    expect(await readDesignData(designId)).toMatchObject({
      tweakSelections: { accent: "#1b7585", extra: true },
    });

    await expect(
      clearPendingEdits(args, {
        caller: "frontend",
        userEmail: "editor@example.com",
      }),
    ).rejects.toThrow(/handoff author or design owner/);
    expect(await readDesignData(designId)).toMatchObject({
      tweakSelections: { accent: "#1b7585", extra: true },
    });

    accessState.role = "owner";
    await expect(clearPendingEdits(args)).resolves.toMatchObject({
      cleared: true,
      handoffCleared: true,
    });
    expect(await readDesignData(designId)).toMatchObject({
      tweakSelections: { accent: "#00dff6" },
    });
  });

  it("lets the handoff author clear it from another browser session", async () => {
    const designId = "design_clear_author_browser";
    await seedChangedTweaks(designId);
    const foreignPublisher = "22222222-2222-4222-8222-222222222222";
    const published = await publish(
      designId,
      1,
      [tweakRecord("accent", "#1b7585")],
      foreignPublisher,
    );
    await getDbExec().execute({
      sql: `UPDATE design_visual_edit_pending SET author_email = $2 WHERE design_id = $1`,
      args: [designId, "editor@example.com"],
    });

    await expect(
      getPendingAction.run(
        { designId },
        { caller: "frontend", userEmail: "editor@example.com" },
      ),
    ).resolves.toMatchObject({ canClear: true });
    await expect(
      clearPendingEdits(
        {
          designId,
          revision: published.revision ?? 0,
          publisherId: foreignPublisher,
        },
        { caller: "frontend", userEmail: "editor@example.com" },
      ),
    ).resolves.toMatchObject({ cleared: true, handoffCleared: true });
    expect(await readDesignData(designId)).toMatchObject({
      tweakSelections: { accent: "#00dff6" },
    });
  });

  it("lets a design-scoped browser capability clear only its own handoff", async () => {
    const designId = "design_clear_capability_publisher";
    await seedChangedTweaks(designId);
    const publisherSessionId = "a".repeat(64);
    const published = await publish(
      designId,
      1,
      [tweakRecord("accent", "#1b7585")],
      publisherId,
      publisherSessionId,
    );

    await expect(
      clearPendingEdits(
        {
          designId,
          revision: published.revision ?? 0,
          publisherId,
        },
        { caller: "frontend" },
      ),
    ).rejects.toThrow(/handoff author or design owner/);

    await expect(
      runWithRequestContext(
        { authCapability: "capability:visual-edit:design:another_design" },
        () =>
          clearPendingEdits(
            {
              designId,
              revision: published.revision ?? 0,
              publisherId,
            },
            { caller: "frontend" },
          ),
      ),
    ).rejects.toThrow(/handoff author or design owner/);

    await expect(
      runWithRequestContext(
        {
          authCapability: `capability:visual-edit:design:${designId}`,
          capabilitySessionId: "b".repeat(64),
        },
        () => getPendingAction.run({ designId }, { caller: "frontend" }),
      ),
    ).resolves.toMatchObject({ canClear: false });
    accessState.role = "admin";
    await expect(
      runWithRequestContext(
        {
          authCapability: `capability:visual-edit:design:${designId}`,
          capabilitySessionId: publisherSessionId,
        },
        () => getPendingAction.run({ designId }, { caller: "frontend" }),
      ),
    ).resolves.toMatchObject({ canClear: true });
    await expect(
      runWithRequestContext(
        {
          authCapability: `capability:visual-edit:design:${designId}`,
          capabilitySessionId: publisherSessionId,
        },
        () =>
          clearPendingEdits(
            {
              designId,
              revision: (published.revision ?? 0) + 1,
              publisherId,
            },
            { caller: "frontend" },
          ),
      ),
    ).resolves.toMatchObject({ cleared: false, stale: true });
    await expect(
      runWithRequestContext(
        {
          authCapability: `capability:visual-edit:design:${designId}`,
          capabilitySessionId: publisherSessionId,
        },
        () =>
          clearPendingEdits(
            {
              designId,
              revision: published.revision ?? 0,
              publisherId,
            },
            { caller: "frontend" },
          ),
      ),
    ).resolves.toMatchObject({ cleared: true, handoffCleared: true });
    expect(await readDesignData(designId)).toMatchObject({
      tweakSelections: { accent: "#00dff6" },
    });
  });

  it("rejects delayed tweak saves and acknowledgements after the revision was cleared", async () => {
    const designId = "design_clear_tweak_save_race";
    await seedDesign(designId, { accent: "#00dff6" });
    await getDbExec().execute({
      sql: `UPDATE designs SET data = $2 WHERE id = $1`,
      args: [
        designId,
        JSON.stringify({
          tweakSourceBaseline: { accent: "#00dff6" },
          tweakSelections: { accent: "#00dff6" },
        }),
      ],
    });
    const published = await publish(designId, 1, [
      tweakRecord("accent", "#1b7585"),
    ]);
    accessState.role = "owner";

    const cleared = await clearPendingEdits({
      designId,
      revision: published.revision ?? 0,
      publisherId,
    });
    expect(cleared).toMatchObject({
      cleared: true,
      revision: (published.revision ?? 0) + 1,
    });
    expect(await readDesignData(designId)).toMatchObject({
      tweakSelections: { accent: "#00dff6" },
      tweakSelectionsRevision: 1,
    });

    await expect(
      acknowledgePendingAction.run({
        designId,
        revision: published.revision ?? 0,
        appliedTweaks: [{ id: "accent", value: "#1b7585" }],
      }),
    ).resolves.toMatchObject({
      status: "stale",
      stale: true,
      tweakAcknowledgedCount: 0,
    });

    await getDbExec().execute({
      sql: `UPDATE design_visual_edit_pending SET revision = $2 WHERE design_id = $1`,
      args: [designId, published.revision ?? 0],
    });
    await expect(
      acknowledgePendingAction.run({
        designId,
        revision: published.revision ?? 0,
        appliedTweaks: [{ id: "accent", value: "#1b7585" }],
      }),
    ).resolves.toMatchObject({
      status: "stale",
      stale: true,
      tweakAcknowledgedCount: 0,
    });
    await expect(
      applyTweaksAction.run({
        designId,
        selections: { accent: "#1b7585" },
        expectedSelectionsHash: tweakSelectionsHash({ accent: "#00dff6" }),
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(getPendingAction.run({ designId })).resolves.toMatchObject({
      status: "empty",
      pendingEditCount: 0,
    });
    expect(await readDesignData(designId)).toMatchObject({
      tweakSelections: { accent: "#00dff6" },
      tweakSelectionsRevision: 1,
      tweakSourceBaseline: { accent: "#00dff6" },
    });
  });

  it("does not clear a newer revision or a handoff from another publisher", async () => {
    const designId = "design_clear_stale_revision";
    await seedChangedTweaks(designId);
    const first = await publish(designId, 1, [
      tweakRecord("accent", "#1b7585"),
    ]);
    const latest = await publish(designId, 2, [
      tweakRecord("accent", "#155e6a"),
    ]);
    accessState.role = "owner";

    await expect(
      clearPendingEdits({
        designId,
        revision: first.revision ?? 0,
        publisherId,
      }),
    ).resolves.toMatchObject({ cleared: false, stale: true });
    await expect(
      clearPendingEdits({
        designId,
        revision: latest.revision ?? 0,
        publisherId: "22222222-2222-4222-8222-222222222222",
      }),
    ).resolves.toMatchObject({ cleared: false, stale: true });
    expect(await readDesignData(designId)).toMatchObject({
      tweakSelections: { accent: "#1b7585", extra: true },
    });
    await expect(getPendingAction.run({ designId })).resolves.toMatchObject({
      status: "ready",
      revision: latest.revision,
    });
  });

  it("requires editor access before clearing", async () => {
    vi.mocked(assertAccess).mockRejectedValueOnce(
      new Error("no editor access"),
    );
    await expect(
      clearEditsAction.run({
        designId: "design_clear_no_access",
        expectedTweakSelectionsRevision: 0,
      }),
    ).rejects.toThrow("no editor access");
  });
});
