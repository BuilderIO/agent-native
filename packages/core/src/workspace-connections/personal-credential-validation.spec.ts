import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import type { DbExec } from "../db/client.js";
import { __resetSecretsRegistry } from "../secrets/register.js";
import { runWithRequestContext } from "../server/request-context.js";
import { resolveWorkspaceConnectionCredentialForApp } from "./credentials.js";
import {
  createPersonalWorkspaceCredentialService,
  type PersonalWorkspaceCredentialServiceOptions,
  type PersonalWorkspaceCredentialValidationInput,
} from "./personal-credentials.js";

// The database adapter supplies isolated, actual SQL storage; the credential
// service, native authorization, encryption and resolver remain real.
let exec: DbExec;
vi.mock("../db/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/client.js")>();
  return { ...actual, getDbExec: () => actual.getScopedDbExec() ?? exec };
});

let db: Awaited<ReturnType<typeof createTestPglite>>;
let failTransaction = false;
let savedEncryptionKey: string | undefined;
const APP = "credential-validation-app";
const OWNER = "owner@example.test";
const ORG = "credential-validation-org";
const PROVIDER = "fixture-warehouse";
const KEY = "WAREHOUSE_CREDENTIAL";
const VALUE = "flagged-source-credential";
const providers = [
  {
    id: PROVIDER,
    label: "Warehouse",
    credentialKeys: [{ key: KEY, label: "Credential", required: true }],
    configurationFields: [
      { key: "project", label: "Project", defaultValue: "default-project" },
    ],
  },
];
function input(operationId = "validation-operation") {
  return {
    operationId,
    provider: ` ${PROVIDER} `,
    secretValues: [{ key: ` ${KEY} `, secret: ` ${VALUE} ` }],
  };
}
async function asOwner<T>(job: () => Promise<T>): Promise<T> {
  return runWithRequestContext({ userEmail: OWNER, orgId: ORG }, job);
}
function service(
  validateCredentials: PersonalWorkspaceCredentialServiceOptions["validateCredentials"],
) {
  return createPersonalWorkspaceCredentialService({
    appId: APP,
    providers,
    validateCredentials,
  });
}
async function artifacts() {
  const counts: number[] = [];
  for (const table of [
    "workspace_connections",
    "workspace_connection_grants",
    "app_secrets",
  ]) {
    const exists = await db.query(
      "SELECT to_regclass(?) IS NOT NULL AS present",
      [`public.${table}`],
    );
    if (!(exists.rows[0] as { present: boolean } | undefined)?.present) {
      counts.push(0);
      continue;
    }
    const result = await db.query(`SELECT count(*)::int AS n FROM ${table}`);
    counts.push(Number((result.rows[0] as { n: number } | undefined)?.n));
  }
  return counts;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(async () => {
  savedEncryptionKey = process.env.SECRETS_ENCRYPTION_KEY;
  process.env.SECRETS_ENCRYPTION_KEY = "credential-validation-test-key";
  __resetSecretsRegistry();
  failTransaction = false;
  db = await createTestPglite();
  exec = {
    async execute(command) {
      if (typeof command === "string") {
        await db.exec(command);
        return { rows: [], rowsAffected: 0 };
      }
      const result = await db.query(command.sql, [...(command.args ?? [])]);
      return {
        rows: result.rows,
        rowsAffected: result.affectedRows ?? result.rows.length,
      };
    },
    async transaction(job) {
      if (failTransaction) throw new Error("controlled transaction failure");
      return db.transaction(job);
    },
  };
  await db.exec(
    "CREATE TABLE org_members (org_id TEXT, email TEXT, role TEXT, joined_at BIGINT, federation_removal_pending_at TIMESTAMPTZ)",
  );
  await db.query("INSERT INTO org_members VALUES (?, ?, 'member', 0, NULL)", [
    ORG,
    OWNER,
  ]);
}, 30_000);
afterEach(async () => {
  if (savedEncryptionKey === undefined)
    delete process.env.SECRETS_ENCRYPTION_KEY;
  else process.env.SECRETS_ENCRYPTION_KEY = savedEncryptionKey;
  __resetSecretsRegistry();
  await db.close();
}, 30_000);

describe("personal credential provider validation before publication", () => {
  it("keeps pending and rejected validation entirely unpublished and redacts errors", async () => {
    const entered = deferred();
    const release = deferred();
    const validator = vi.fn(async () => {
      entered.resolve();
      await release.promise;
      throw new Error(VALUE);
    });
    const api = service(validator);
    const creation = asOwner(() => api.create(input()));
    const outcome = creation.catch((error: unknown) => error);
    try {
      await entered.promise;
      expect(await artifacts()).toEqual([0, 0, 0]);
      expect(
        await asOwner(() =>
          api.findCreatedConnection({ operationId: input().operationId }),
        ),
      ).toBeNull();
    } finally {
      release.resolve();
    }
    const error = await outcome;
    expect(error).toMatchObject({
      code: "validator_rejected",
      message: "The credential value was rejected.",
    });
    expect(String(error)).not.toContain(VALUE);
    expect(error).not.toHaveProperty("cause");
    expect(await artifacts()).toEqual([0, 0, 0]);
    expect(validator).toHaveBeenCalledTimes(1);
  });

  it("validates an immutable normalized snapshot and persists those exact values", async () => {
    const raw = input();
    let observed: PersonalWorkspaceCredentialValidationInput | undefined;
    const api = service(async (snapshot) => {
      observed = snapshot;
      expect(snapshot).toEqual({
        provider: PROVIDER,
        config: { project: "default-project" },
        secretValues: [{ key: KEY, secret: VALUE }],
      });
      expect(Object.isFrozen(snapshot)).toBe(true);
      expect(Object.isFrozen(snapshot.config)).toBe(true);
      expect(Object.isFrozen(snapshot.secretValues)).toBe(true);
      expect(Object.isFrozen(snapshot.secretValues[0])).toBe(true);
      expect(Reflect.set(snapshot.config, "project", "changed-project")).toBe(
        false,
      );
      expect(
        Reflect.set(snapshot.secretValues[0]!, "secret", "changed-credential"),
      ).toBe(false);
      raw.secretValues[0]!.secret = "input-mutated-after-normalization";
    });
    const { connectionId } = await asOwner(() => api.create(raw));
    expect(observed?.secretValues[0]?.secret).toBe(VALUE);
    const resolved = await asOwner(() =>
      resolveWorkspaceConnectionCredentialForApp({
        appId: APP,
        connectionId,
        provider: PROVIDER,
        key: KEY,
      }),
    );
    expect(resolved).toMatchObject({ available: true, value: VALUE });
    expect(await artifacts()).toEqual([1, 1, 1]);
    const other = await runWithRequestContext(
      { userEmail: "other@example.test", orgId: ORG },
      () =>
        resolveWorkspaceConnectionCredentialForApp({
          appId: APP,
          connectionId,
          provider: PROVIDER,
          key: KEY,
        }),
    );
    expect(other.available).toBe(false);
  });

  it("rechecks membership after the asynchronous check before publishing", async () => {
    const api = service(async () => {
      await db.query("DELETE FROM org_members WHERE org_id = ? AND email = ?", [
        ORG,
        OWNER,
      ]);
    });
    await expect(asOwner(() => api.create(input()))).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(await artifacts()).toEqual([0, 0, 0]);
  });

  it("never publishes a truthy invalid validator return value", async () => {
    const invalid = (async () => true) as unknown as NonNullable<
      PersonalWorkspaceCredentialServiceOptions["validateCredentials"]
    >;
    await expect(
      asOwner(() => service(invalid).create(input())),
    ).rejects.toMatchObject({ code: "validator_rejected" });
    expect(await artifacts()).toEqual([0, 0, 0]);
  });

  it("keeps validated operations atomic when the transaction cannot begin", async () => {
    const validator = vi.fn(async () => {
      failTransaction = true;
    });
    await expect(
      asOwner(() => service(validator).create(input())),
    ).rejects.toMatchObject({ code: "write_failed" });
    expect(validator).toHaveBeenCalledTimes(1);
    expect(await artifacts()).toEqual([0, 0, 0]);
  });

  it("preserves replay identity, revalidates replays, and refuses different values", async () => {
    const validator = vi.fn(async () => {});
    const api = service(validator);
    const first = await asOwner(() => api.create(input()));
    expect(await asOwner(() => api.create(input()))).toEqual(first);
    const changed = input();
    changed.secretValues[0]!.secret = "different-credential";
    await expect(asOwner(() => api.create(changed))).rejects.toMatchObject({
      code: "conflict",
    });
    expect(validator).toHaveBeenCalledTimes(3);
    expect(await artifacts()).toEqual([1, 1, 1]);
  });
  it("never hands values to a validator without an authenticated context", async () => {
    const validator = vi.fn(async () => {});
    await expect(service(validator).create(input())).rejects.toMatchObject({
      code: "unauthenticated",
    });
    expect(validator).not.toHaveBeenCalled();
    expect(await artifacts()).toEqual([0, 0, 0]);
  });

  it("serializes matching and conflicting concurrent validated operations", async () => {
    let calls = 0;
    let entered = deferred();
    let release = deferred();
    const api = service(async () => {
      calls++;
      if (calls % 2 === 0) entered.resolve();
      await release.promise;
    });
    const matching = Promise.all([
      asOwner(() => api.create(input("same-concurrent"))),
      asOwner(() => api.create(input("same-concurrent"))),
    ]);
    try {
      await entered.promise;
      expect(await artifacts()).toEqual([0, 0, 0]);
    } finally {
      release.resolve();
    }
    const pair = await matching;
    expect(pair[0]).toEqual(pair[1]);
    expect(await artifacts()).toEqual([1, 1, 1]);

    entered = deferred();
    release = deferred();
    const left = input("different-concurrent");
    const right = input("different-concurrent");
    right.secretValues[0]!.secret = "different-credential";
    const competing = Promise.allSettled([
      asOwner(() => api.create(left)),
      asOwner(() => api.create(right)),
    ]);
    try {
      await entered.promise;
      expect(await artifacts()).toEqual([1, 1, 1]);
    } finally {
      release.resolve();
    }
    const outcomes = await competing;
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.status === "rejected"),
    ).toHaveLength(1);
    const rejection = outcomes.find((outcome) => outcome.status === "rejected");
    expect(rejection?.reason).toMatchObject({ code: "conflict" });
    for (const [index, outcome] of outcomes.entries()) {
      if (outcome.status !== "fulfilled") continue;
      const resolved = await asOwner(() =>
        resolveWorkspaceConnectionCredentialForApp({
          appId: APP,
          connectionId: outcome.value.connectionId,
          provider: PROVIDER,
          key: KEY,
        }),
      );
      expect(resolved.value).toBe(index === 0 ? VALUE : "different-credential");
    }
    expect(calls).toBe(4);
    expect(await artifacts()).toEqual([2, 2, 2]);
  });
});
