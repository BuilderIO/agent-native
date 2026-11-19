import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import { getScopedDbExec, type DbExec } from "../db/client.js";
import { __resetSecretsRegistry } from "../secrets/register.js";
import {
  getRequestContext,
  runWithRequestContext,
} from "../server/request-context.js";
import {
  createPersonalWorkspaceCredentialArchiveService,
  PersonalWorkspaceCredentialArchiveError,
} from "./personal-credential-archive.js";
import {
  createPersonalWorkspaceCredentialService,
  PersonalWorkspaceCredentialError,
} from "./personal-credentials.js";
import {
  ensureWorkspaceConnectionsTable,
  getWorkspaceConnection,
  listWorkspaceConnectionsForApp,
} from "./store.js";

vi.setConfig({ testTimeout: 120_000 });

const effectOf = vi.hoisted(() =>
  vi.fn((_error: unknown): string | undefined => undefined),
);

vi.mock("../action.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../action.js")>();
  return { ...actual, actionFailureEffect: effectOf };
});

let currentExec: DbExec | undefined;

vi.mock("../db/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/client.js")>();
  return {
    ...actual,
    getDbExec: () => actual.getScopedDbExec() ?? fixtureExec(),
  };
});

type TestPglite = Awaited<ReturnType<typeof createTestPglite>>;
type Row = Record<string, unknown>;
type Context = Parameters<typeof runWithRequestContext>[0];
type Statement = { sql: string; args: unknown[] };
type Hook = () => void | Promise<void>;

const LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))";
const UPDATE_PREFIX = "UPDATE public.workspace_connections";
const APP_ID = "app-personal-archive";
const OTHER_APP_ID = "app-personal-archive-other";
const ALICE = "alice@example.test";
const BOB = "bob@example.test";
const ORG_ID = "org-personal-archive";
const MISSING_ID = `pconn1:${"1".repeat(64)}`;
const STATIC_MESSAGE =
  "Personal credential archive outcome could not be confirmed.";
const ORG_MEMBERS_DDL =
  "CREATE TABLE IF NOT EXISTS org_members (org_id TEXT, email TEXT, role TEXT, joined_at BIGINT, federation_removal_pending_at TIMESTAMPTZ)";

let pglite: TestPglite;
let statements: Statement[] = [];
let recording = false;
let corruptUpdateCount = false;
let afterCommit: (() => void) | null = null;
let memberReads = 0;
let memberHooks = new Map<number, Hook>();

function fixtureExec(): DbExec {
  if (currentExec === undefined)
    throw new Error("fixture exec is not initialized");
  return currentExec;
}

async function observeMemberRead(): Promise<void> {
  memberReads += 1;
  const hook = memberHooks.get(memberReads);
  if (hook === undefined) return;
  memberHooks.delete(memberReads);
  await hook();
}

function armMemberHook(at: number, hook: Hook): void {
  memberReads = 0;
  memberHooks = new Map([[at, hook]]);
}

function instrument(exec: DbExec): DbExec {
  // raw-sql-ok: test wrapper forwards the caller's statement unchanged
  return {
    execute: async (input) => {
      const sql = typeof input === "string" ? input : input.sql;
      const args: unknown[] =
        typeof input === "string" ? [] : (input.args ?? []);
      if (recording) {
        // raw-sql-ok: records the forwarded statement for assertions
        statements.push({ sql, args });
      }
      if (
        sql.trimStart().toUpperCase().startsWith("SELECT") &&
        sql.includes("org_members")
      ) {
        await observeMemberRead();
      }
      const result = await exec.execute(input);
      return corruptUpdateCount && sql.startsWith(UPDATE_PREFIX)
        ? { ...result, rowsAffected: Number.NaN }
        : result;
    },
  };
}

function buildExec(): DbExec {
  const raw: DbExec = {
    execute: async (input) => {
      if (typeof input === "string") {
        await pglite.exec(input);
        return { rows: [], rowsAffected: 0 };
      }
      const result = await pglite.query(input.sql, input.args ?? []);
      return { rows: result.rows, rowsAffected: result.affectedRows ?? 0 };
    },
  };
  return {
    ...instrument(raw),
    transaction: async <T>(fn: (tx: DbExec) => Promise<T>): Promise<T> => {
      const result = await pglite.transaction((tx) => fn(instrument(tx)));
      const hook = afterCommit;
      afterCommit = null;
      hook?.();
      return result;
    },
  };
}

async function rows(sql: string, args: unknown[] = []): Promise<Row[]> {
  return (await pglite.query(sql, args)).rows as Row[];
}

async function connectionRow(id: string): Promise<Row> {
  const [row] = await rows(
    "SELECT * FROM public.workspace_connections WHERE id = ?",
    [id],
  );
  if (!row) throw new Error("connection row is missing");
  return row;
}

function asUser<T>(
  email: string,
  fn: () => Promise<T>,
  orgId?: string,
): Promise<T> {
  const context: Context =
    orgId === undefined ? { userEmail: email } : { userEmail: email, orgId };
  return runWithRequestContext(context, fn);
}

async function listedIds(): Promise<string[]> {
  const listed = await asUser(ALICE, () =>
    listWorkspaceConnectionsForApp({ appId: APP_ID }),
  );
  return listed.map((connection) => connection.id);
}

function archiveService() {
  return createPersonalWorkspaceCredentialArchiveService({ appId: APP_ID });
}

function archiveAs(
  connectionId: string,
  email: string,
  orgId?: string,
): Promise<{ archived: boolean }> {
  return asUser(email, () => archiveService().archive({ connectionId }), orgId);
}

async function createProfile(
  email: string,
  operationId: string,
  orgId?: string,
): Promise<string> {
  const created = await asUser(
    email,
    () =>
      createPersonalWorkspaceCredentialService({ appId: APP_ID }).create({
        operationId,
        provider: "slack",
        name: "Synthetic Slack",
        secretValues: [
          { key: "SLACK_BOT_TOKEN", secret: "synthetic-token-value" },
        ],
      }),
    orgId,
  );
  return created.connectionId;
}

async function seedOrgMember(
  orgId: string,
  email: string,
  role: string,
): Promise<void> {
  await pglite.query(
    "INSERT INTO org_members (id, org_id, email, role, joined_at, federation_removal_pending_at) VALUES (?, ?, ?, ?, 0, NULL)",
    [`${orgId}:${email}`, orgId, email, role],
  );
}

async function removeOrgMember(orgId: string, email: string): Promise<void> {
  await (getScopedDbExec() ?? fixtureExec()).execute({
    sql: "DELETE FROM org_members WHERE org_id = ? AND email = ?",
    args: [orgId, email],
  });
}

async function orgProfile(operationId: string): Promise<string> {
  await seedOrgMember(ORG_ID, ALICE, "admin");
  return createProfile(ALICE, operationId, ORG_ID);
}

function countUpdates(list: Statement[] = statements): number {
  return list.filter((statement) => statement.sql.startsWith(UPDATE_PREFIX))
    .length;
}

function lastStatementSql(): string {
  return statements[statements.length - 1]?.sql ?? "";
}

async function expectArchiveError(
  promise: Promise<unknown>,
  code: string,
  statusCode: number,
): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (failure: unknown) => failure,
  );
  expect(error).toBeInstanceOf(PersonalWorkspaceCredentialArchiveError);
  const typed = error as PersonalWorkspaceCredentialArchiveError;
  expect(typed.code).toBe(code);
  expect(typed.statusCode).toBe(statusCode);
  expect(typed.message).toBe(STATIC_MESSAGE);
}

beforeEach(async () => {
  process.env.SECRETS_ENCRYPTION_KEY = "personal-archive-test-key";
  __resetSecretsRegistry();
  effectOf.mockReset();
  statements = [];
  recording = false;
  corruptUpdateCount = false;
  afterCommit = null;
  memberReads = 0;
  memberHooks = new Map();
  pglite = await createTestPglite();
  currentExec = buildExec();
  await ensureWorkspaceConnectionsTable();
  await pglite.exec(ORG_MEMBERS_DDL);
}, 30_000);

afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env.AGENT_USER_EMAIL;
  __resetSecretsRegistry();
  currentExec = undefined;
  await pglite.close();
}, 30_000);

describe("personal credential archive", () => {
  describe("own profile", () => {
    it("disables only the status and keeps grants, secret rows, and config", async () => {
      const id = await createProfile(ALICE, "op-archive-own");
      const before = await connectionRow(id);
      const grantsBefore = await rows(
        "SELECT * FROM public.workspace_connection_grants ORDER BY 1",
      );
      const secretsBefore = await rows("SELECT * FROM app_secrets ORDER BY 1");
      expect(before.status).not.toBe("disabled");
      expect(await listedIds()).toContain(id);

      recording = true;
      expect(await archiveAs(id, ALICE)).toEqual({ archived: true });
      recording = false;

      expect(
        statements.some((statement) => statement.sql.includes("app_secrets")),
      ).toBe(false);
      const after = await connectionRow(id);
      expect(after.status).toBe("disabled");
      expect({
        ...after,
        status: before.status,
        updated_at: before.updated_at,
      }).toEqual(before);
      expect(Number(after.updated_at)).toBeGreaterThanOrEqual(
        Number(before.updated_at),
      );
      expect(
        await rows(
          "SELECT * FROM public.workspace_connection_grants ORDER BY 1",
        ),
      ).toEqual(grantsBefore);
      expect(await rows("SELECT * FROM app_secrets ORDER BY 1")).toEqual(
        secretsBefore,
      );
      expect(await listedIds()).not.toContain(id);
      expect(
        (await asUser(ALICE, () => getWorkspaceConnection(id)))?.status,
      ).toBe("disabled");
    });

    it("returns false for a missing owned row without any write", async () => {
      recording = true;
      expect(await archiveAs(MISSING_ID, ALICE)).toEqual({ archived: false });
      recording = false;
      expect(countUpdates()).toBe(0);
    });

    it("is idempotent: a repeated archive returns true without a second write", async () => {
      const id = await createProfile(ALICE, "op-archive-repeat");
      expect(await archiveAs(id, ALICE)).toEqual({ archived: true });
      const first = await connectionRow(id);
      statements = [];
      recording = true;
      expect(await archiveAs(id, ALICE)).toEqual({ archived: true });
      recording = false;
      expect(countUpdates()).toBe(0);
      expect(await connectionRow(id)).toEqual(first);
    });

    it("locks the owned row with the exact create-matching advisory lock before the status update", async () => {
      const id = await createProfile(ALICE, "op-archive-lock");
      recording = true;
      expect(await archiveAs(id, ALICE)).toEqual({ archived: true });
      recording = false;
      expect(
        statements.filter((statement) => statement.sql === LOCK_SQL),
      ).toEqual([
        { sql: LOCK_SQL, args: [`personal-workspace-credential:${id}`] },
      ]);
      const lockAt = statements.findIndex(
        (statement) => statement.sql === LOCK_SQL,
      );
      const updateAt = statements.findIndex((statement) =>
        statement.sql.startsWith(UPDATE_PREFIX),
      );
      expect(lockAt).toBeGreaterThanOrEqual(0);
      expect(lockAt).toBeLessThan(updateAt);
    });

    it("lets no other member or organization modify the profile", async () => {
      const id = await createProfile(ALICE, "op-archive-foreign");
      const before = await connectionRow(id);
      expect(await archiveAs(id, BOB)).toEqual({ archived: false });
      await seedOrgMember(ORG_ID, ALICE, "member");
      expect(await archiveAs(id, ALICE, ORG_ID)).toEqual({ archived: false });
      expect(await connectionRow(id)).toEqual(before);
    });

    it("denies an org caller who is not a member", async () => {
      const id = await createProfile(ALICE, "op-archive-nonmember");
      await expectArchiveError(archiveAs(id, BOB, ORG_ID), "forbidden", 403);
      expect((await connectionRow(id)).status).not.toBe("disabled");
    });

    it("denies an app that is not the exclusive grantee", async () => {
      const id = await createProfile(ALICE, "op-archive-other-app");
      const before = await connectionRow(id);
      const otherApp = createPersonalWorkspaceCredentialArchiveService({
        appId: OTHER_APP_ID,
      });
      await expectArchiveError(
        asUser(ALICE, () => otherApp.archive({ connectionId: id })),
        "forbidden",
        403,
      );
      expect(await connectionRow(id)).toEqual(before);
    });
  });

  describe("membership and actor gates", () => {
    it.each([1, 2, 3, 4])(
      "denies when org membership is removed before member read %i",
      async (readNumber) => {
        const id = await orgProfile(`op-archive-member-${readNumber}`);
        armMemberHook(readNumber, () => removeOrgMember(ORG_ID, ALICE));
        recording = true;
        await expectArchiveError(
          archiveAs(id, ALICE, ORG_ID),
          "forbidden",
          403,
        );
        recording = false;
        expect(countUpdates()).toBe(0);
        expect((await connectionRow(id)).status).not.toBe("disabled");
      },
    );

    it("denies when the actor changes immediately before the status update", async () => {
      const id = await orgProfile("op-archive-actor");
      const context: Context = { userEmail: ALICE, orgId: ORG_ID };
      armMemberHook(4, () => {
        const captured = getRequestContext();
        if (!captured) throw new Error("fixture context missing");
        captured.userEmail = BOB;
      });
      recording = true;
      await expectArchiveError(
        runWithRequestContext(context, () =>
          archiveService().archive({ connectionId: id }),
        ),
        "forbidden",
        403,
      );
      recording = false;
      expect(countUpdates()).toBe(0);
      expect((await connectionRow(id)).status).not.toBe("disabled");
    });
  });

  describe("input and request context", () => {
    it("rejects malformed ids, extra keys, accessors, and factory forgery", async () => {
      const id = await createProfile(ALICE, "op-archive-input");
      const svc = archiveService();
      await expectArchiveError(
        asUser(ALICE, () => svc.archive({ connectionId: "pconn1:ABC" })),
        "invalid_input",
        400,
      );
      const forged = { connectionId: id, actorEmail: BOB };
      await expectArchiveError(
        asUser(ALICE, () => svc.archive(forged as { connectionId: string })),
        "invalid_input",
        400,
      );
      const withAccessor: { connectionId?: string } = {};
      Object.defineProperty(withAccessor, "connectionId", {
        enumerable: true,
        get: () => id,
      });
      await expectArchiveError(
        asUser(ALICE, () =>
          svc.archive(withAccessor as { connectionId: string }),
        ),
        "invalid_input",
        400,
      );
      expect(() =>
        createPersonalWorkspaceCredentialArchiveService({
          appId: APP_ID,
          orgId: ORG_ID,
        } as { appId: string }),
      ).toThrow(PersonalWorkspaceCredentialArchiveError);
      expect(() =>
        createPersonalWorkspaceCredentialArchiveService({ appId: "   " }),
      ).toThrow(PersonalWorkspaceCredentialArchiveError);
      expect((await connectionRow(id)).status).not.toBe("disabled");
    });

    it("denies missing, blank, null, or empty identity without the env fallback", async () => {
      const id = await createProfile(ALICE, "op-archive-identity");
      process.env.AGENT_USER_EMAIL = ALICE;
      await expectArchiveError(
        archiveService().archive({ connectionId: id }),
        "unauthenticated",
        401,
      );
      await expectArchiveError(
        asUser("   ", () => archiveService().archive({ connectionId: id })),
        "unauthenticated",
        401,
      );
      await expectArchiveError(
        runWithRequestContext(
          { userEmail: ALICE, orgId: null } as unknown as Context,
          () => archiveService().archive({ connectionId: id }),
        ),
        "unauthenticated",
        401,
      );
      await expectArchiveError(
        asUser(
          ALICE,
          () => archiveService().archive({ connectionId: id }),
          "   ",
        ),
        "unauthenticated",
        401,
      );
      expect((await connectionRow(id)).status).not.toBe("disabled");
    });

    it("denies an org-scoped credential context", async () => {
      const id = await createProfile(ALICE, "op-archive-scope");
      await expectArchiveError(
        runWithRequestContext(
          { userEmail: ALICE, credentialScope: "org" } as unknown as Context,
          () => archiveService().archive({ connectionId: id }),
        ),
        "forbidden",
        403,
      );
    });

    it("denies identity read through an accessor", async () => {
      const id = await createProfile(ALICE, "op-archive-accessor");
      await asUser(ALICE, async () => {
        const captured = getRequestContext();
        if (!captured) throw new Error("fixture context missing");
        const getter = vi.fn(() => ALICE);
        Object.defineProperty(captured, "userEmail", {
          enumerable: true,
          configurable: true,
          get: getter,
        });
        await expectArchiveError(
          archiveService().archive({ connectionId: id }),
          "unauthenticated",
          401,
        );
        expect(getter).not.toHaveBeenCalled();
      });
    });

    it.each(["orgId", "credentialScope"])(
      "rejects inherited identity field %s",
      async (key) => {
        const id = await createProfile(ALICE, `op-inherited-${key}`);
        await asUser(ALICE, async () => {
          const captured = getRequestContext();
          if (!captured) throw new Error("missing fixture context");
          Object.setPrototypeOf(captured, { [key]: "org" });
          await expectArchiveError(
            archiveService().archive({ connectionId: id }),
            "unauthenticated",
            401,
          );
        });
        expect((await connectionRow(id)).status).not.toBe("disabled");
      },
    );

    it("ignores unrelated opaque context values", async () => {
      const id = await createProfile(ALICE, "op-archive-opaque");
      const context = {
        userEmail: ALICE,
        opaque: { nested: 1 },
        hook: () => undefined,
      } as unknown as Context;
      expect(
        await runWithRequestContext(context, () =>
          archiveService().archive({ connectionId: id }),
        ),
      ).toEqual({ archived: true });
    });
  });

  describe("transaction and failure classification", () => {
    it("does not report success or missing for an invalid update count", async () => {
      const id = await createProfile(ALICE, "op-archive-count");
      statements = [];
      recording = true;
      corruptUpdateCount = true;
      await expectArchiveError(archiveAs(id, ALICE), "write_failed", 500);
      corruptUpdateCount = false;
      recording = false;
      expect(countUpdates()).toBe(1);
      expect(lastStatementSql().startsWith(UPDATE_PREFIX)).toBe(true);
      expect((await connectionRow(id)).status).not.toBe("disabled");
    });

    it("fails closed when no transaction is available", async () => {
      const id = await createProfile(ALICE, "op-archive-notx");
      const saved = fixtureExec();
      currentExec = { execute: saved.execute };
      try {
        await expectArchiveError(
          archiveAs(id, ALICE),
          "transaction_unavailable",
          503,
        );
      } finally {
        currentExec = saved;
      }
      expect((await connectionRow(id)).status).not.toBe("disabled");
    });

    it("fails closed when reading the transaction method throws", async () => {
      const id = await createProfile(ALICE, "op-archive-getter");
      const saved = fixtureExec();
      currentExec = {
        execute: saved.execute,
        get transaction(): never {
          throw new Error("getter");
        },
      };
      try {
        await expectArchiveError(
          archiveAs(id, ALICE),
          "transaction_unavailable",
          503,
        );
      } finally {
        currentExec = saved;
      }
      expect((await connectionRow(id)).status).not.toBe("disabled");
    });

    it("reports an unknown post-commit failure as write_failed with no readback or second write", async () => {
      const id = await createProfile(ALICE, "op-archive-unknown");
      statements = [];
      recording = true;
      afterCommit = () => {
        throw new Error("commit acknowledgement lost");
      };
      await expectArchiveError(archiveAs(id, ALICE), "write_failed", 500);
      recording = false;
      expect(countUpdates()).toBe(1);
      expect(lastStatementSql().startsWith(UPDATE_PREFIX)).toBe(true);
      expect((await connectionRow(id)).status).toBe("disabled");
    });

    it("keeps an explicit post-commit refusal and does not retry", async () => {
      const id = await createProfile(ALICE, "op-archive-refusal");
      statements = [];
      recording = true;
      afterCommit = () => {
        throw Object.assign(
          Object.create(PersonalWorkspaceCredentialError.prototype),
          {
            code: "refused",
            statusCode: 409,
          },
        );
      };
      await expectArchiveError(archiveAs(id, ALICE), "refused", 409);
      recording = false;
      expect(countUpdates()).toBe(1);
    });

    it.each([403, 409])(
      "keeps a plain %i status refusal as refused without readback",
      async (statusCode) => {
        const id = await createProfile(
          ALICE,
          `op-archive-status-${statusCode}`,
        );
        statements = [];
        recording = true;
        afterCommit = () => {
          throw Object.assign(new Error("status probe"), { statusCode });
        };
        await expectArchiveError(archiveAs(id, ALICE), "refused", statusCode);
        recording = false;
        expect(countUpdates()).toBe(1);
        expect(lastStatementSql().startsWith(UPDATE_PREFIX)).toBe(true);
      },
    );

    it("keeps an actionFailureEffect none refusal as refused 409 with no write", async () => {
      const id = await orgProfile("op-archive-effect");
      effectOf.mockImplementation((error: unknown) =>
        error instanceof Error && error.message === "no-write-probe"
          ? "none"
          : undefined,
      );
      armMemberHook(2, () => {
        throw new Error("no-write-probe");
      });
      recording = true;
      await expectArchiveError(archiveAs(id, ALICE, ORG_ID), "refused", 409);
      recording = false;
      expect(countUpdates()).toBe(0);
      expect((await connectionRow(id)).status).not.toBe("disabled");
    });

    it("classifies an unreadable post-commit error as refused 409 with no readback", async () => {
      const id = await createProfile(ALICE, "op-archive-hostile");
      statements = [];
      recording = true;
      afterCommit = () => {
        throw new Proxy(
          {},
          {
            get() {
              throw new Error("getter");
            },
            getPrototypeOf() {
              throw new Error("prototype");
            },
          },
        );
      };
      await expectArchiveError(archiveAs(id, ALICE), "refused", 409);
      recording = false;
      expect(countUpdates()).toBe(1);
      expect(lastStatementSql().startsWith(UPDATE_PREFIX)).toBe(true);
    });
  });
});
