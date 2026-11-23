import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { closeDbExec, runMigrations } from "@agent-native/core/db";
import {
  ORG_MIGRATIONS,
  organizations,
  orgMembers,
} from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server";
import {
  deleteUserSetting,
  getUserSettingEntry,
  putUserSetting,
} from "@agent-native/core/settings";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { z } from "zod";

vi.mock("../server/formatter/sqlfluff.js", () => ({
  MAX_SQLFLUFF_CONFIG_BYTES: 64 * 1024,
  validateSqlFluffConfig: async (config: string) =>
    config.includes("invalid")
      ? {
          valid: false,
          error: {
            code: "unknown_config_key",
            message: "raw runtime message with a config fragment",
          },
        }
      : {
          valid: true,
          error: null,
          dialect: "bigquery",
          templater: "jinja",
        },
}));

import { getDb } from "../server/db/index.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import {
  SQLFLUFF_VERDICT_TTL_MS,
  sqlFluffVerdictKey,
} from "../server/model/sqlfluff-verdicts.js";
import getVerdict from "./get-data-sql-formatting-verdict.js";
import validate from "./validate-data-sql-formatting.js";

const round = mkdtempSync(join(tmpdir(), "sqlfluff-verdicts-"));
const previousDatabase = process.env.DATABASE_URL;
const owner = "sqlfluff-owner@example.test";
const otherOwner = "sqlfluff-other-owner@example.test";
const member = "sqlfluff-member@example.test";
const orgA = `qa-sqlfluff-a-${randomUUID()}`;
const orgB = `qa-sqlfluff-b-${randomUUID()}`;
// Deliberately collide with the personal sentinel under the old key format.
const literalPersonalOrg = "personal";

function asActor<T>(
  email: string,
  orgId: string,
  orgScope: "personal" | undefined,
  call: () => Promise<T>,
): Promise<T> {
  const result = runWithRequestContext(
    {
      userEmail: email,
      orgId,
      ...(orgScope ? { orgScope } : {}),
      authUserId: email,
      userName: "QA SQLFluff account",
      isSyntheticTraffic: true,
    },
    call,
  );
  return Promise.resolve(result);
}

function actor(email: string, orgId: string | undefined) {
  return {
    caller: "frontend" as const,
    userEmail: email,
    orgId: orgId ?? null,
  };
}

async function record(
  requestId: string,
  config: string,
  email = owner,
  orgId = orgA,
  orgScope: "personal" | undefined = undefined,
) {
  return asActor(email, orgId, orgScope, () =>
    validate.run(
      { connectionType: "bigquery", config, requestId },
      actor(email, orgScope ? undefined : orgId),
    ),
  );
}

async function read(
  requestId: string,
  email = owner,
  orgId = orgA,
  orgScope: "personal" | undefined = undefined,
) {
  return asActor(email, orgId, orgScope, () =>
    getVerdict.run({ requestId }, actor(email, orgScope ? undefined : orgId)),
  );
}

const ownerKeyA = () => sqlFluffVerdictKey({ userEmail: owner, orgId: orgA });
const ownerKeyB = () => sqlFluffVerdictKey({ userEmail: owner, orgId: orgB });
const ownerPersonalKey = () =>
  sqlFluffVerdictKey({ userEmail: owner, orgId: undefined });
const ownerLiteralPersonalKey = () =>
  sqlFluffVerdictKey({ userEmail: owner, orgId: literalPersonalOrg });
const otherOwnerKeyA = () =>
  sqlFluffVerdictKey({ userEmail: otherOwner, orgId: orgA });

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${join(round, "database")}`;
  await runMigrations([...ORG_MIGRATIONS], {
    table: "qa_sqlfluff_verdict_org_migrations",
  })(null);
  await ensureAnalyticsDatabase();
  await getDb()
    .insert(organizations)
    .values(
      [orgA, orgB, literalPersonalOrg].map((id) => ({
        id,
        name: "QA SQLFluff workspace",
        createdBy: owner,
        createdAt: Date.now(),
      })),
    );
  await getDb()
    .insert(orgMembers)
    .values([
      {
        id: randomUUID(),
        orgId: orgA,
        email: owner,
        role: "owner",
        joinedAt: Date.now(),
      },
      {
        id: randomUUID(),
        orgId: orgB,
        email: owner,
        role: "owner",
        joinedAt: Date.now(),
      },
      {
        id: randomUUID(),
        orgId: literalPersonalOrg,
        email: owner,
        role: "owner",
        joinedAt: Date.now(),
      },
      {
        id: randomUUID(),
        orgId: orgA,
        email: otherOwner,
        role: "owner",
        joinedAt: Date.now(),
      },
      {
        id: randomUUID(),
        orgId: orgA,
        email: member,
        role: "member",
        joinedAt: Date.now(),
      },
    ]);
});

beforeEach(async () => {
  for (const key of [
    ownerKeyA(),
    ownerKeyB(),
    ownerPersonalKey(),
    ownerLiteralPersonalKey(),
    otherOwnerKeyA(),
  ])
    await deleteUserSetting(owner, key);
  await deleteUserSetting(otherOwner, otherOwnerKeyA());
});

afterAll(async () => {
  await closeDbExec();
  if (previousDatabase === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabase;
  const owned = resolve(round);
  const temporary = resolve(tmpdir());
  if (
    owned !== temporary &&
    owned !== resolve(process.cwd()) &&
    owned.startsWith(temporary + "/sqlfluff-verdicts-")
  )
    rmSync(owned, { recursive: true, force: true });
  else throw new Error("Refused cleanup outside this test round");
});

describe("SQLFluff verdict readback", () => {
  it("returns a valid verdict and an invalid verdict with only its safe code", async () => {
    const validId = randomUUID();
    const invalidId = randomUUID();
    await expect(record(validId, "dialect = bigquery\n")).resolves.toEqual({
      valid: true,
      error: null,
    });
    await expect(record(invalidId, "invalid = true\n")).resolves.toEqual({
      valid: false,
      error: "raw runtime message with a config fragment",
    });
    await expect(read(validId)).resolves.toEqual({
      valid: true,
      errorCode: null,
    });
    await expect(read(invalidId)).resolves.toEqual({
      valid: false,
      errorCode: "unknown_config_key",
    });
  });

  it("isolates the verdict by actor and by organisation", async () => {
    const requestId = randomUUID();
    await record(requestId, "dialect = bigquery\n");
    await expect(read(requestId, otherOwner, orgA)).rejects.toMatchObject({
      errorCode: "data_sqlfluff_verdict_not_found",
      statusCode: 404,
    });
    await expect(read(requestId, owner, orgB)).rejects.toMatchObject({
      errorCode: "data_sqlfluff_verdict_not_found",
      statusCode: 404,
    });
    await expect(read(requestId, member, orgA)).rejects.toMatchObject({
      errorCode: "data_connection_admin_required",
      statusCode: 403,
    });
  });

  it("keeps personal scope separate from the organisation scope", async () => {
    const requestId = randomUUID();
    await record(requestId, "dialect = bigquery\n", owner, orgA, "personal");
    await expect(read(requestId, owner, orgA, "personal")).resolves.toEqual({
      valid: true,
      errorCode: null,
    });
    await expect(read(requestId, owner, orgA)).rejects.toMatchObject({
      errorCode: "data_sqlfluff_verdict_not_found",
    });
  });

  it("keeps a literal org id 'personal' disjoint from personal scope", async () => {
    const orgRequestId = randomUUID();
    const personalRequestId = randomUUID();
    await record(
      orgRequestId,
      "dialect = bigquery\n",
      owner,
      literalPersonalOrg,
    );
    await record(
      personalRequestId,
      "dialect = bigquery\n",
      owner,
      orgA,
      "personal",
    );
    await expect(
      read(orgRequestId, owner, literalPersonalOrg),
    ).resolves.toEqual({ valid: true, errorCode: null });
    await expect(
      read(personalRequestId, owner, orgA, "personal"),
    ).resolves.toEqual({ valid: true, errorCode: null });
    await expect(
      read(orgRequestId, owner, orgA, "personal"),
    ).rejects.toMatchObject({
      errorCode: "data_sqlfluff_verdict_not_found",
    });
    await expect(
      read(personalRequestId, owner, literalPersonalOrg),
    ).rejects.toMatchObject({
      errorCode: "data_sqlfluff_verdict_not_found",
    });
  });

  it("keeps only the newest eight verdicts", async () => {
    const ids = Array.from({ length: 9 }, () => randomUUID());
    for (const id of ids) await record(id, "dialect = bigquery\n");
    const [oldest, ...newest] = ids;
    if (!oldest) throw new Error("the verdict fixture is empty");
    await expect(read(oldest)).rejects.toMatchObject({
      errorCode: "data_sqlfluff_verdict_not_found",
    });
    for (const id of newest) {
      await expect(read(id)).resolves.toEqual({
        valid: true,
        errorCode: null,
      });
    }
    const entry = await getUserSettingEntry(owner, ownerKeyA(), {
      bypassCache: true,
    });
    if (!entry.found) throw new Error("the owner verdict store is missing");
    const store = z
      .object({ verdicts: z.array(z.unknown()) })
      .safeParse(entry.value);
    if (!store.success) throw new Error("the owner verdict store is malformed");
    expect(store.data.verdicts).toHaveLength(8);
  });

  it("rejects an expired verdict and preserves a seeded expiry without replay", async () => {
    const requestId = randomUUID();
    await putUserSetting(owner, ownerKeyA(), {
      verdicts: [
        {
          requestId,
          valid: true,
          errorCode: null,
          createdAt: Date.now() - SQLFLUFF_VERDICT_TTL_MS - 1,
        },
      ],
    });
    await expect(read(requestId)).rejects.toMatchObject({
      errorCode: "data_sqlfluff_verdict_not_found",
      statusCode: 404,
    });
  });

  it("distinguishes malformed data from an absent verdict", async () => {
    const requestId = randomUUID();
    await putUserSetting(owner, ownerKeyA(), { verdicts: "not-an-array" });
    await expect(read(requestId)).rejects.toMatchObject({
      errorCode: "data_sqlfluff_verdict_unreadable",
      statusCode: 503,
    });
    await deleteUserSetting(owner, ownerKeyA());
    await expect(read(requestId)).rejects.toMatchObject({
      errorCode: "data_sqlfluff_verdict_not_found",
      statusCode: 404,
    });
  });

  it("reads zero after its own scoped cleanup", async () => {
    const requestId = randomUUID();
    await record(requestId, "dialect = bigquery\n");
    await deleteUserSetting(owner, ownerKeyA());
    await expect(
      getUserSettingEntry(owner, ownerKeyA(), { bypassCache: true }),
    ).resolves.toEqual({ found: false });
    await expect(read(requestId)).rejects.toMatchObject({
      errorCode: "data_sqlfluff_verdict_not_found",
    });
  });
});
