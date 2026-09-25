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
import getPendingAction from "./get-visual-edit-pending.js";
import publishPendingAction from "./publish-visual-edit-pending.js";

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
