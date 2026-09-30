import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDbExec, createGetDb, getDbExec } from "@agent-native/core/db";
import {
  createSharesTable,
  ownableColumns,
  table,
  text,
} from "@agent-native/core/db/schema";
import { registerLabs } from "@agent-native/core/labs/registry";
import { getUserLabs } from "@agent-native/core/labs/server";
import { runWithRequestContext } from "@agent-native/core/server";
import { putSetting } from "@agent-native/core/settings";
import {
  getShareableResource,
  registerShareableResource,
} from "@agent-native/core/sharing";
import { eq, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { CREATIVE_CONTEXT_LIBRARY_LAB } from "../labs.js";
import * as schema from "../schema/index.js";
import { recordGenerationCreativeContext as recordLocal } from "../store/generation.js";
import { recordGenerationCreativeContext } from "./generation-context.js";
import { configureCreativeContext, creativeContextDbPlugin } from "./index.js";

const OWNER = "generation-owner@example.test";
const EDITOR = "generation-editor@example.test";
const VIEWER = "generation-viewer@example.test";
const NO_PACK_ACCESS = "generation-no-pack@example.test";
const ORG = "generation-transaction-org";
const LAB = "creative-context.library";
const decks = table("generation_test_decks", {
  id: text("id").primaryKey(),
  ...ownableColumns(),
});
const deckShares = createSharesTable("generation_test_deck_shares");
const getDb = createGetDb({ ...schema, decks, deckShares });

describe("generation context uses the supplied transaction", () => {
  let directory: string;
  let db: ReturnType<typeof getDb>;
  let artifactId: string;
  let packId: string;
  let insideTransaction = false;
  let queries: string[] = [];
  let globalQueries: string[] = [];
  let globalDbCalls = 0;

  const asUser = <T>(email: string, run: () => T | Promise<T>) =>
    runWithRequestContext({ userEmail: email, orgId: ORG }, run);

  const input = () => ({
    appId: "slides",
    artifactType: "deck",
    artifactId,
    contextMode: "pinned" as const,
    contextPackId: packId,
    reuseLabels: [],
  });

  async function inTransaction<T>(
    run: (
      tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    ) => Promise<T>,
  ) {
    return db.transaction(async (tx) => {
      insideTransaction = true;
      const execute = tx.execute.bind(tx);
      const spy = vi.spyOn(tx, "execute").mockImplementation((query) => {
        queries.push(new PgDialect().sqlToQuery(query.getSQL()).sql);
        return execute(query);
      });
      try {
        return await run(tx);
      } finally {
        spy.mockRestore();
        insideTransaction = false;
      }
    });
  }

  async function records() {
    return db
      .select()
      .from(schema.generationRecords)
      .where(eq(schema.generationRecords.artifactId, artifactId));
  }

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), "generation-context-transaction-"));
    vi.stubEnv("APP_NAME", "");
    for (const key of [
      "DATABASE_URL",
      "DATABASE_URL_UNPOOLED",
      "NETLIFY_DATABASE_URL",
      "NETLIFY_DATABASE_URL_UNPOOLED",
    ]) {
      vi.stubEnv(key, `pglite:${directory}`);
    }
    vi.stubEnv("CREATIVE_CONTEXT_A2A_URL", "");
    configureCreativeContext({
      getDb: () => {
        if (insideTransaction) {
          throw new Error("Generation store escaped to global getDb");
        }
        return getDb();
      },
    });
    registerLabs([CREATIVE_CONTEXT_LIBRARY_LAB]);
    await creativeContextDbPlugin(undefined as never);
    const exec = getDbExec();
    await exec.execute(`
      CREATE TABLE generation_test_decks (
        id TEXT PRIMARY KEY, owner_email TEXT NOT NULL,
        org_id TEXT, visibility TEXT NOT NULL DEFAULT 'private'
      )
    `);
    await exec.execute(`
      CREATE TABLE generation_test_deck_shares (
        id TEXT PRIMARY KEY, resource_id TEXT NOT NULL,
        principal_type TEXT NOT NULL, principal_id TEXT NOT NULL,
        role TEXT NOT NULL, created_by TEXT NOT NULL,
        created_at BIGINT NOT NULL DEFAULT 0, notified_at BIGINT
      )
    `);
    await exec.execute(`
      CREATE TABLE IF NOT EXISTS org_members (
        id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL,
        role TEXT NOT NULL, joined_at BIGINT NOT NULL,
        federation_removal_pending_at BIGINT
      )
    `);
    for (const email of [EDITOR, VIEWER, NO_PACK_ACCESS]) {
      await exec.execute({
        sql: "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES (?, ?, ?, ?, ?)",
        args: [crypto.randomUUID(), ORG, email, "member", 0],
      });
      await putSetting(`u:${email}:labs`, { [LAB]: true });
    }
    registerShareableResource({
      type: "deck",
      resourceTable: decks,
      sharesTable: deckShares,
      displayName: "Deck",
      getDb,
    });
    await getDb().select().from(decks).limit(1);
    db = getDb();
    const execute = exec.execute.bind(exec);
    vi.spyOn(exec, "execute").mockImplementation((statement) => {
      if (insideTransaction) {
        throw new Error("Generation check escaped to the global executor");
      }
      globalQueries.push(
        typeof statement === "string" ? statement : statement.sql,
      );
      return execute(statement);
    });
    for (const type of ["deck", "creative-context-pack"]) {
      const registration = getShareableResource(type)!;
      const original = registration.getDb;
      vi.spyOn(registration, "getDb").mockImplementation(() => {
        if (insideTransaction) {
          throw new Error(`Generation ${type} check escaped to global getDb`);
        }
        globalDbCalls++;
        return original();
      });
    }
  }, 60_000);

  beforeEach(async () => {
    artifactId = crypto.randomUUID();
    packId = crypto.randomUUID();
    await db
      .insert(decks)
      .values({ id: artifactId, ownerEmail: OWNER, orgId: ORG });
    await db.insert(deckShares).values(
      [EDITOR, VIEWER, NO_PACK_ACCESS].map((email) => ({
        id: crypto.randomUUID(),
        resourceId: artifactId,
        principalType: "user" as const,
        principalId: email,
        role: email === VIEWER ? ("viewer" as const) : ("editor" as const),
        createdBy: OWNER,
      })),
    );
    await db.insert(schema.contextPacks).values({
      id: packId,
      name: "Generation transaction pack",
      ownerEmail: OWNER,
      orgId: ORG,
      createdAt: new Date().toISOString(),
    });
    for (const email of [EDITOR, VIEWER]) {
      await getDbExec().execute({
        sql: "INSERT INTO creative_context_pack_shares (id, resource_id, principal_type, principal_id, role, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        args: [
          crypto.randomUUID(),
          packId,
          "user",
          email,
          "viewer",
          OWNER,
          Date.now(),
        ],
      });
    }
    queries = [];
    globalQueries = [];
    globalDbCalls = 0;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await closeDbExec();
    vi.unstubAllEnvs();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }, 60_000);

  it.each([false, true])(
    "records an org Slides deck through transaction lab, artifact and pack checks with warm lab cache=%s",
    async (warmCache) => {
      const result = await asUser(EDITOR, async () => {
        if (warmCache) await getUserLabs(EDITOR);
        globalQueries = [];
        return inTransaction((tx) =>
          recordGenerationCreativeContext(input(), { db: tx }),
        );
      });
      expect(result).toMatchObject({
        artifactId,
        contextPackId: packId,
        orgId: ORG,
      });
      expect(await records()).toHaveLength(1);
      expect(globalQueries).toEqual([]);
      expect(globalDbCalls).toBe(0);
      expect(
        queries.some((query) =>
          /SELECT value FROM public.settings/i.test(query),
        ),
      ).toBe(true);
      for (const name of [
        "generation_test_decks",
        "generation_test_deck_shares",
        "creative_context_packs",
        "creative_context_pack_shares",
      ]) {
        expect(queries.some((query) => query.includes(`from "${name}"`))).toBe(
          true,
        );
      }
    },
  );

  it("checks a pack on the supplied connection when recording directly in the local store", async () => {
    await asUser(EDITOR, () =>
      inTransaction((tx) => recordLocal(input(), { db: tx })),
    );
    expect(await records()).toHaveLength(1);
    expect(globalDbCalls).toBe(0);
    expect(globalQueries).toEqual([]);
    expect(
      queries.some((query) => /from "creative_context_packs"/.test(query)),
    ).toBe(true);
  });

  it.each([
    [VIEWER, "Requires editor role on deck"],
    [NO_PACK_ACCESS, "No access to creative-context-pack"],
  ])(
    "rejects %s inside the transaction without recording",
    async (email, message) => {
      await expect(
        asUser(email, () =>
          inTransaction((tx) =>
            recordGenerationCreativeContext(input(), { db: tx }),
          ),
        ),
      ).rejects.toThrow(message);
      expect(await records()).toEqual([]);
      expect(globalDbCalls).toBe(0);
      expect(globalQueries).toEqual([]);
    },
  );

  it("does not cache a lab value read from a rolled-back transaction in the same request", async () => {
    await asUser(EDITOR, async () => {
      await expect(
        inTransaction(async (tx) => {
          await tx.execute(
            sql`UPDATE public.settings SET value = ${JSON.stringify({ [LAB]: false })} WHERE key = ${`u:${EDITOR}:labs`}`,
          );
          expect(
            await recordGenerationCreativeContext(input(), { db: tx }),
          ).toBeNull();
          expect(
            await tx
              .select()
              .from(schema.generationRecords)
              .where(eq(schema.generationRecords.artifactId, artifactId)),
          ).toEqual([]);
          throw new Error("Roll back the lab change");
        }),
      ).rejects.toThrow("Roll back the lab change");
      expect(await recordGenerationCreativeContext(input())).toMatchObject({
        artifactId,
        contextPackId: packId,
        orgId: ORG,
      });
    });
    expect(await records()).toHaveLength(1);
  });

  it("keeps global lab and access reads when no db is supplied", async () => {
    const result = await asUser(EDITOR, () =>
      recordGenerationCreativeContext(input()),
    );
    expect(result).toMatchObject({
      artifactId,
      contextPackId: packId,
      orgId: ORG,
    });
    expect(await records()).toHaveLength(1);
    expect(
      globalQueries.some((query) =>
        /SELECT value FROM public.settings/i.test(query),
      ),
    ).toBe(true);
    expect(globalDbCalls).toBeGreaterThanOrEqual(2);
    expect(queries).toEqual([]);
  });
});
