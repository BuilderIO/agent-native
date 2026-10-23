import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readAppState } from "@agent-native/core/application-state";
import { closeDbExec, getDbExec } from "@agent-native/core/db";
import {
  createPollHandler,
  getPollEmitter,
  POLL_CHANGE_EVENT,
  runWithRequestContext,
} from "@agent-native/core/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  middleware: [] as Array<{
    path: string;
    handler: (event: unknown) => Promise<unknown>;
  }>,
}));

vi.mock("@agent-native/core/server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/server")>();
  return {
    ...actual,
    getH3App: () => ({
      use: (path: string, handler: (event: unknown) => Promise<unknown>) => {
        mocks.middleware.push({ path, handler });
      },
    }),
  };
});

const TEST_DB_PATH = join(
  tmpdir(),
  `slides-2-presenter-${process.pid}-${Date.now()}.pglite`,
);
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalAppUrl = process.env.APP_URL;
const OWNER = {
  userEmail: "presenter-owner@example.test",
  orgId: "presenter-org",
};
const DECK_ID = "presenter-roundtrip-deck";
const QUEUE_KEY = "slides-2:presenter-control-queue";

let dbModule: typeof import("../server/db/index.js");
let controlPresenter: typeof import("./control-presenter.js").default;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  process.env.APP_URL = "https://slides-2.example.test";
  dbModule = await import("../server/db/index.js");
  controlPresenter = (await import("./control-presenter.js")).default;

  const plugin = (await import("../server/plugins/db.js")).default;
  plugin({ h3: {} } as never);
  const readiness = mocks.middleware.find(
    ({ path }) => path === "/_agent-native",
  )?.handler;
  if (!readiness) {
    throw new Error("Slides DB plugin did not register readiness middleware");
  }
  await readiness({});

  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL,
    created_at BIGINT NOT NULL, identity_authority TEXT, identity_id TEXT
  )`);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS org_members (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL,
    role TEXT NOT NULL, joined_at BIGINT NOT NULL,
    federation_removal_pending_at INTEGER
  )`);
  await dbModule
    .getDb()
    .insert(dbModule.schema.decks)
    .values({
      id: DECK_ID,
      title: "Presenter roundtrip",
      data: JSON.stringify({
        appId: "slides-2",
        slides: [{ id: "slide-1" }, { id: "slide-2" }],
      }),
      ownerEmail: OWNER.userEmail,
      orgId: OWNER.orgId,
      visibility: "private",
      createdAt: "2026-10-20T00:00:00.000Z",
      updatedAt: "2026-10-20T00:00:00.000Z",
    });

  createPollHandler();
}, 120000);

afterAll(async () => {
  await closeDbExec();
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = originalAppUrl;
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

describe("control-presenter SQL and realtime projection", () => {
  it("persists the command and publishes its linked app-state change", async () => {
    const pollEvents: Array<Record<string, unknown>> = [];
    const onPollChange = (event: Record<string, unknown>) => {
      pollEvents.push(event);
    };
    getPollEmitter().on(POLL_CHANGE_EVENT, onPollChange);

    try {
      const result = await runWithRequestContext(OWNER, () =>
        controlPresenter.run({ operation: "next", deckId: DECK_ID }),
      );
      const persisted = await getDbExec().execute<{
        session_id: string;
        key: string;
        value: string;
      }>({
        sql: "SELECT session_id, key, value FROM application_state WHERE session_id = ? AND key = ?",
        args: [OWNER.userEmail, QUEUE_KEY],
      });
      const projectionQueue = await runWithRequestContext(OWNER, () =>
        readAppState(QUEUE_KEY),
      );

      expect(persisted.rows).toHaveLength(1);
      expect(persisted.rows[0]?.session_id).toBe(OWNER.userEmail);
      expect(persisted.rows[0]?.key).toBe(QUEUE_KEY);
      expect(projectionQueue).toEqual(JSON.parse(persisted.rows[0]!.value));
      expect(projectionQueue).toEqual({
        commands: [
          expect.objectContaining({
            commandId: result.commandId,
            deckId: DECK_ID,
            operation: "next",
            issuedAt: result.issuedAt,
          }),
        ],
      });
      expect(pollEvents).toContainEqual(
        expect.objectContaining({
          source: "app-state",
          type: "change",
          key: QUEUE_KEY,
          owner: OWNER.userEmail,
          requestSource: "agent",
        }),
      );
      expect(result).toMatchObject({
        deckId: DECK_ID,
        operation: "next",
        message: "Presenter command queued for the open console.",
      });
    } finally {
      getPollEmitter().removeListener(POLL_CHANGE_EVENT, onPollChange);
    }
  });
});
