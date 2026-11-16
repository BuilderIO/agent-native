import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import { IDENTITY_REKEY_COLUMNS } from "../identity/rekey.js";
import { runWithRequestContext } from "../server/request-context.js";
import {
  beginUserIntegrationGrant,
  completeUserIntegrationGrant,
  getUserIntegrationGrant,
  resolveUserIntegrationGrant,
  revokeUserIntegrationGrant,
  ensureUserIntegrationGrantsTable,
  UserIntegrationGrantUnavailableError,
  UserIntegrationGrantConflictError,
  UserIntegrationGrantUnknownOutcomeError,
} from "./user-grants-store.js";

type Hook = (...args: any[]) => any;
const state = vi.hoisted(() => ({
  exec: null as any,
  vault: new Map<string, string>(),
  hooks: {} as Record<string, Hook | undefined>,
}));

vi.mock("../db/client.js", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, getDbExec: () => state.exec };
});

const vaultKey = (scope: string, scopeId: string, key: string) =>
  JSON.stringify([scope, scopeId, key]);
const normalizeRef = (args: any[]) =>
  args.length === 1 && args[0] && typeof args[0] === "object"
    ? args[0]
    : { scope: args[0], scopeId: args[1], key: args[2] };
const normalizeWrite = (args: any[]) =>
  args.length === 1 && args[0] && typeof args[0] === "object"
    ? args[0]
    : { scope: args[0], scopeId: args[1], key: args[2], value: args[3] };

vi.mock("../secrets/storage.js", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    readAppSecret: async (...args: any[]) => {
      const ref = normalizeRef(args);
      if (state.hooks.beforeVaultRead) await state.hooks.beforeVaultRead(ref);
      let value = state.vault.get(vaultKey(ref.scope, ref.scopeId, ref.key));
      if (value === undefined) return null;
      if (state.hooks.afterVaultRead) {
        const replaced = await state.hooks.afterVaultRead(value, ref);
        if (typeof replaced === "string") value = replaced;
      }
      return { value };
    },
    writeAppSecret: async (...args: any[]) => {
      const write = normalizeWrite(args);
      if (state.hooks.beforeVaultWrite)
        await state.hooks.beforeVaultWrite(write);
      state.vault.set(
        vaultKey(write.scope, write.scopeId, write.key),
        write.value,
      );
      return { ...write };
    },
  };
});

const A = {
  authUserId: "auth-user-a",
  userEmail: "same@example.test",
  orgId: "org-1",
};
const B = {
  authUserId: "auth-user-b",
  userEmail: "b@example.test",
  orgId: "org-1",
};
const SAME_EMAIL = {
  authUserId: "auth-user-c",
  userEmail: "same@example.test",
  orgId: "org-1",
};
const PERSONAL_A = {
  authUserId: "auth-user-a",
  userEmail: "same@example.test",
};
const LITERAL_PERSONAL_A = {
  authUserId: "auth-user-a",
  userEmail: "same@example.test",
  orgId: "personal",
};
const EMPTY_ORG_A = {
  authUserId: "auth-user-a",
  userEmail: "same@example.test",
  orgId: "",
};
const TUPLE = {
  provider: "example-chat",
  teamId: "T_SYNTH_1",
  apiAppId: "A_SYNTH_1",
  externalUserId: "U_SYNTH_1",
};
const OP1 = "op-synthetic-0001";
const OP2 = "op-synthetic-0002";
const BUNDLE = {
  accessToken: "synthetic-access-a-1",
  refreshToken: "synthetic-refresh-a-1",
  tokenType: "user",
  expiresAt: 4000000000000,
  scopes: ["channels:read", "search:read"],
};
const bundleWith = (
  accessToken: string,
  extra: Record<string, unknown> = {},
) => ({ ...BUNDLE, accessToken, ...extra });
const META_KEYS = [
  "apiAppId",
  "createdAt",
  "expiresAt",
  "externalUserId",
  "generation",
  "id",
  "provider",
  "scopes",
  "status",
  "teamId",
  "updatedAt",
];

let pg: any;
let fetchSpy: any;

const resetHooks = () => {
  state.hooks = {};
};
// raw-sql-ok: test helper; every caller passes a fixed literal statement with bound args.
const sql = (text: string, params: unknown[] = []): Promise<any[]> =>
  state.exec.execute({ sql: text, args: params }).then((r: any) => r.rows);
const rowOf = async (grantId: string) =>
  (
    await sql(
      "SELECT status, generation, token_secret_key, owner_email FROM integration_user_grants WHERE id = ?",
      [grantId],
    )
  )[0];

async function seedOrgMembership(
  orgId: string,
  emails: string[],
  role = "owner",
) {
  for (const email of emails) {
    await pg.query(
      "INSERT INTO org_members (org_id, email, role, federation_removal_pending_at) VALUES (?, ?, ?, NULL) ON CONFLICT DO NOTHING",
      [orgId, email, role],
    );
  }
}

const as = <T>(actor: unknown, fn: () => Promise<T>) =>
  runWithRequestContext(actor as any, fn);
const begin = (
  actor: any,
  operationId = OP1,
  tuple: Record<string, string> = TUPLE,
): Promise<any> =>
  as(actor, () => beginUserIntegrationGrant({ ...tuple, operationId } as any));
const complete = (
  actor: any,
  attempt: any,
  bundle: any = BUNDLE,
): Promise<any> =>
  as(actor, () => completeUserIntegrationGrant(attempt, bundle));
const get = (actor: any, grantId: string): Promise<any> =>
  as(actor, () => getUserIntegrationGrant(grantId));
const resolve = (actor: any, grantId: string): Promise<any> =>
  as(actor, () => resolveUserIntegrationGrant(grantId));
const revoke = (actor: any, grantId: string): Promise<any> =>
  as(actor, () => revokeUserIntegrationGrant(grantId));
const connect = async (actor: any, operationId = OP1, bundle: any = BUNDLE) => {
  const attempt = await begin(actor, operationId);
  const meta = await complete(actor, attempt, bundle);
  return { attempt, meta };
};

function rekeyPairs(registry: any): Array<{ table: string; column: string }> {
  const out: Array<{ table: string; column: string }> = [];
  const addEntry = (entry: any) => {
    if (typeof entry === "string") {
      const [table, column] = entry.split(".");
      if (table && column) out.push({ table, column });
      return;
    }
    if (entry && typeof entry === "object") {
      if (typeof entry.table === "string" && typeof entry.column === "string") {
        out.push({ table: entry.table, column: entry.column });
        return;
      }
      for (const [table, cols] of Object.entries(entry)) {
        for (const column of (Array.isArray(cols) ? cols : [cols]) as any[]) {
          if (typeof column === "string") out.push({ table, column });
        }
      }
    }
  };
  if (Array.isArray(registry) || registry instanceof Set)
    for (const entry of registry as any) addEntry(entry);
  else if (registry && typeof registry === "object") addEntry(registry);
  return out;
}

beforeAll(async () => {
  pg = await createTestPglite();
  state.exec = {
    async execute(input: any) {
      if (typeof input === "string") {
        await pg.exec(input);
        return { rows: [], rowsAffected: 0 };
      }
      const text = String(input.sql);
      const args = (input.args ?? []).map((v: unknown) =>
        v === undefined ? null : v,
      );
      const isPublish =
        text.includes("integration_user_grants") &&
        text.toUpperCase().includes("UPDATE") &&
        args.some(
          (a: unknown) =>
            typeof a === "string" && a.startsWith("integration-user-grant:"),
        );
      if (isPublish && state.hooks.beforePublish)
        await state.hooks.beforePublish(input);
      const result = await pg.query(text, args);
      const out = { rows: result.rows, rowsAffected: result.affectedRows ?? 0 };
      if (isPublish && state.hooks.afterPublish)
        state.hooks.afterPublish(input, out);
      return out;
    },
  };
  await ensureUserIntegrationGrantsTable();
  await pg.exec(
    "CREATE TABLE IF NOT EXISTS org_members (org_id TEXT, email TEXT, role TEXT, federation_removal_pending_at BIGINT)",
  );
  await pg.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS org_members_org_email_idx ON org_members (org_id, LOWER(email))",
  );
});

beforeEach(async () => {
  await pg.query("DELETE FROM integration_user_grants");
  await pg.query("DELETE FROM org_members");
  state.vault.clear();
  resetHooks();
  await seedOrgMembership("org-1", ["same@example.test", "b@example.test"]);
  await seedOrgMembership("personal", ["same@example.test"]);
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  resetHooks();
  vi.restoreAllMocks();
});

afterAll(async () => {
  state.exec = null;
  await pg.close();
});

describe("user integration grant store (acceptance)", () => {
  it("1 denies unauthenticated, ambient, and empty-identity callers before any vault or row access", async () => {
    const seam = vi.fn();
    state.hooks.beforeVaultWrite = seam;
    state.hooks.beforeVaultRead = seam;
    await expect(
      beginUserIntegrationGrant({ ...TUPLE, operationId: OP1 } as any),
    ).rejects.toBeInstanceOf(UserIntegrationGrantUnavailableError);
    await expect(begin({ ...A, authUserId: "" })).rejects.toBeInstanceOf(
      UserIntegrationGrantUnavailableError,
    );
    await expect(begin({ ...A, userEmail: "" })).rejects.toBeInstanceOf(
      UserIntegrationGrantUnavailableError,
    );
    await expect(
      getUserIntegrationGrant("uig_" + "0".repeat(64)),
    ).rejects.toBeInstanceOf(UserIntegrationGrantUnavailableError);
    expect(seam).not.toHaveBeenCalled();
    expect(
      Number(
        (await sql("SELECT COUNT(*) AS n FROM integration_user_grants"))[0].n,
      ),
    ).toBe(0);
  });

  it("2 isolates two local members who authorize the same remote tuple", async () => {
    const a = await connect(A, OP1, bundleWith("synthetic-access-a-1"));
    const b = await connect(B, OP1, bundleWith("synthetic-access-b-1"));
    expect(a.attempt.grantId).not.toBe(b.attempt.grantId);
    expect((await resolve(A, a.attempt.grantId))?.accessToken).toBe(
      "synthetic-access-a-1",
    );
    expect((await resolve(B, b.attempt.grantId))?.accessToken).toBe(
      "synthetic-access-b-1",
    );
    expect(await resolve(A, b.attempt.grantId)).toBeNull();
    expect(await resolve(B, a.attempt.grantId)).toBeNull();
  });

  it("3 denies a guessed foreign grant id to a same-org member with no vault access", async () => {
    const { attempt } = await connect(A);
    const seam = vi.fn();
    state.hooks.beforeVaultRead = seam;
    state.hooks.beforeVaultWrite = seam;
    expect(await get(B, attempt.grantId)).toBeNull();
    expect(await resolve(B, attempt.grantId)).toBeNull();
    expect(await revoke(B, attempt.grantId)).toBeNull();
    await expect(
      complete(B, attempt, bundleWith("synthetic-access-b-forged")),
    ).rejects.toBeInstanceOf(UserIntegrationGrantUnavailableError);
    expect(seam).not.toHaveBeenCalled();
    expect((await rowOf(attempt.grantId)).status).toBe("connected");
  });

  it("4 denies same-email different stable identity and never falls back to the email owner", async () => {
    const { attempt } = await connect(A);
    expect(await get(SAME_EMAIL, attempt.grantId)).toBeNull();
    expect(await resolve(SAME_EMAIL, attempt.grantId)).toBeNull();
    await expect(complete(SAME_EMAIL, attempt)).rejects.toBeInstanceOf(
      UserIntegrationGrantUnavailableError,
    );
    const other = await begin(SAME_EMAIL);
    expect(other.grantId).not.toBe(attempt.grantId);
    expect((await resolve(A, attempt.grantId))?.accessToken).toBe(
      BUNDLE.accessToken,
    );
  });

  it("5 keeps absent org distinct from literal personal org and rejects empty org", async () => {
    const personal = await begin(PERSONAL_A);
    const literal = await begin(LITERAL_PERSONAL_A);
    expect(personal.grantId).not.toBe(literal.grantId);
    expect(await get(LITERAL_PERSONAL_A, personal.grantId)).toBeNull();
    expect(await get(PERSONAL_A, literal.grantId)).toBeNull();
    await expect(begin(EMPTY_ORG_A)).rejects.toBeInstanceOf(
      UserIntegrationGrantUnavailableError,
    );
  });

  it("6 returns the same attempt for a duplicate begin and increments generation only for a new operation", async () => {
    const first = await begin(A, OP1);
    const again = await begin(A, OP1);
    expect(again).toEqual(first);
    expect(first.generation).toBe(1);
    const second = await begin(A, OP2);
    expect(second.grantId).toBe(first.grantId);
    expect(second.generation).toBe(2);
    const row = await rowOf(first.grantId);
    expect(row.status).toBe("pending");
    expect(Number(row.generation)).toBe(2);
  });

  it("7 does not revive a revoked grant from a historical operation", async () => {
    const { attempt } = await connect(A, OP1);
    await revoke(A, attempt.grantId);
    const revived = await begin(A, OP1);
    expect(revived).toEqual(attempt);
    await expect(complete(A, revived)).rejects.toBeInstanceOf(
      UserIntegrationGrantConflictError,
    );
    const meta = await get(A, attempt.grantId);
    expect(meta?.status).toBe("revoked");
    expect(meta?.generation).toBe(attempt.generation + 1);
    expect(await resolve(A, attempt.grantId)).toBeNull();
  });

  it("8 treats an identical duplicate completion as safe metadata and a different payload as conflict", async () => {
    const { attempt, meta } = await connect(A, OP1, BUNDLE);
    const dup = await complete(A, attempt, {
      ...BUNDLE,
      scopes: [...BUNDLE.scopes],
    });
    expect(dup).toEqual(meta);
    await expect(
      complete(A, attempt, bundleWith("synthetic-access-a-b")),
    ).rejects.toBeInstanceOf(UserIntegrationGrantConflictError);
    expect((await resolve(A, attempt.grantId))?.accessToken).toBe(
      BUNDLE.accessToken,
    );
  });

  it("9 keeps the published pointer immutable when two completions both reach publish", async () => {
    const attempt = await begin(A);
    let arrivals = 0;
    let onBoth!: () => void;
    const bothReached = new Promise<void>((r) => {
      onBoth = r;
    });
    let openGate!: () => void;
    const gate = new Promise<void>((r) => {
      openGate = r;
    });
    state.hooks.beforePublish = async () => {
      arrivals += 1;
      if (arrivals === 2) onBoth();
      await gate;
    };
    const p1 = complete(A, attempt, bundleWith("synthetic-access-a-race-1"));
    const p2 = complete(A, attempt, bundleWith("synthetic-access-a-race-b"));
    await bothReached;
    openGate();
    const settled = await Promise.allSettled([p1, p2]);
    const fulfilled = settled.filter((s) => s.status === "fulfilled");
    const rejected = settled.filter((s) => s.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      UserIntegrationGrantConflictError,
    );
    const winnerPayload =
      settled[0].status === "fulfilled"
        ? "synthetic-access-a-race-1"
        : "synthetic-access-a-race-b";
    expect((await resolve(A, attempt.grantId))?.accessToken).toBe(
      winnerPayload,
    );
    const row = await rowOf(attempt.grantId);
    expect(row.status).toBe("connected");
    expect(
      String(row.token_secret_key).startsWith(
        "integration-user-grant:" + attempt.grantId + ":",
      ),
    ).toBe(true);
    expect(Number(row.generation)).toBe(attempt.generation);
  });

  it("10 denies old-generation completions after a newer begin or a revoke", async () => {
    const old = await begin(A, OP1);
    const current = await begin(A, OP2);
    expect(current.generation).toBe(old.generation + 1);
    await expect(complete(A, old)).rejects.toBeInstanceOf(
      UserIntegrationGrantConflictError,
    );
    await complete(A, current);
    await revoke(A, current.grantId);
    await expect(complete(A, current)).rejects.toBeInstanceOf(
      UserIntegrationGrantConflictError,
    );
    expect((await rowOf(current.grantId)).status).toBe("revoked");
    expect(await resolve(A, current.grantId)).toBeNull();
  });

  it("11 returns null when revoke lands during the vault read", async () => {
    const { attempt } = await connect(A);
    let onRead!: () => void;
    const readStarted = new Promise<void>((r) => {
      onRead = r;
    });
    let openRead!: () => void;
    const readGate = new Promise<void>((r) => {
      openRead = r;
    });
    state.hooks.beforeVaultRead = async () => {
      onRead();
      await readGate;
    };
    const pending = resolve(A, attempt.grantId);
    await readStarted;
    resetHooks();
    await revoke(A, attempt.grantId);
    openRead();
    expect(await pending).toBeNull();
    expect((await rowOf(attempt.grantId)).status).toBe("revoked");
    expect(await resolve(A, attempt.grantId)).toBeNull();
  });

  it("12 treats expiresAt as an exclusive boundary on the controlled clock and never refreshes", async () => {
    let now = 1000000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const EXPIRES = 2000000;
    const attempt = await begin(A);
    await complete(
      A,
      attempt,
      bundleWith("synthetic-access-a-expiry", { expiresAt: EXPIRES }),
    );
    now = EXPIRES - 1;
    expect((await resolve(A, attempt.grantId))?.accessToken).toBe(
      "synthetic-access-a-expiry",
    );
    now = EXPIRES;
    expect(await resolve(A, attempt.grantId)).toBeNull();
    const meta = await get(A, attempt.grantId);
    expect(meta?.status).toBe("connected");
    expect(meta?.expiresAt).toBe(EXPIRES);
  });

  it("13 returns null for a malformed or unknown-field stored bundle without logging or echoing the payload", async () => {
    const { attempt } = await connect(A);
    const spies = ["log", "info", "warn", "error", "debug"].map((m) =>
      vi.spyOn(console, m as "log"),
    );
    state.hooks.afterVaultRead = () =>
      JSON.stringify({
        accessToken: "SYNTHETIC-MALFORMED-MARKER",
        tokenType: "user",
      }).slice(0, -1);
    expect(await resolve(A, attempt.grantId)).toBeNull();
    state.hooks.afterVaultRead = () =>
      JSON.stringify({ ...BUNDLE, unexpected: "SYNTHETIC-EXTRA-MARKER" });
    expect(await resolve(A, attempt.grantId)).toBeNull();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("14 maps a vault write failure to unknown outcome, never publishes, and redacts the cause", async () => {
    const attempt = await begin(A);
    state.hooks.beforeVaultWrite = () => {
      throw new Error("SYNTHETIC-VAULT-MARKER");
    };
    const err: any = await complete(A, attempt).catch((e) => e);
    expect(err).toBeInstanceOf(UserIntegrationGrantUnknownOutcomeError);
    expect(String(err.message)).not.toContain("SYNTHETIC-VAULT-MARKER");
    expect(String(err.message)).not.toContain("synthetic-access");
    expect(String(err.stack ?? "")).not.toContain("SYNTHETIC-VAULT-MARKER");
    const row = await rowOf(attempt.grantId);
    expect(row.status).toBe("pending");
    expect(row.token_secret_key).toBeNull();
  });

  it("15 verifies a publish that committed before its acknowledgement threw", async () => {
    const attempt = await begin(A);
    state.hooks.afterPublish = () => {
      throw new Error("SYNTHETIC-ACK-LOST");
    };
    const meta = await complete(A, attempt, BUNDLE);
    resetHooks();
    expect(Object.keys(meta).sort()).toEqual([...META_KEYS].sort());
    expect(meta.status).toBe("connected");
    expect((await resolve(A, attempt.grantId))?.accessToken).toBe(
      BUNDLE.accessToken,
    );
  });

  it("16 registers grant owner_email in the identity rekey registry (registered coverage only, not a lifecycle receipt)", () => {
    expect(rekeyPairs(IDENTITY_REKEY_COLUMNS)).toContainEqual({
      table: "integration_user_grants",
      column: "owner_email",
    });
  });

  it("17 completes a full grant lifecycle with no provider fetch", async () => {
    const { attempt } = await connect(A);
    await resolve(A, attempt.grantId);
    await revoke(A, attempt.grantId);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("18 refuses to publish a pointer under a stale owner_email after a rekey race", async () => {
    const attempt = await begin(A);
    state.hooks.beforePublish = async () => {
      resetHooks();
      await pg.query(
        "UPDATE integration_user_grants SET owner_email = ? WHERE id = ?",
        ["rekeyed@example.test", attempt.grantId],
      );
    };
    await expect(complete(A, attempt)).rejects.toBeInstanceOf(
      UserIntegrationGrantConflictError,
    );
    const row = await rowOf(attempt.grantId);
    expect(row.status).toBe("pending");
    expect(row.token_secret_key).toBeNull();
    expect(await resolve(A, attempt.grantId)).toBeNull();
    const meta = await complete(A, attempt);
    expect(meta.status).toBe("connected");
    const row2 = await rowOf(attempt.grantId);
    expect(
      String(row2.token_secret_key).startsWith(
        "integration-user-grant:" + attempt.grantId + ":",
      ),
    ).toBe(true);
    expect((await resolve(A, attempt.grantId))?.accessToken).toBe(
      BUNDLE.accessToken,
    );
  });

  it("19 rejects a completion whose expiresAt is already at or before now, before any vault write", async () => {
    const now = 5000000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const attempt = await begin(A);
    const writeSpy = vi.fn();
    state.hooks.beforeVaultWrite = writeSpy;
    await expect(
      complete(
        A,
        attempt,
        bundleWith("synthetic-access-a-expired", { expiresAt: now }),
      ),
    ).rejects.toBeInstanceOf(UserIntegrationGrantConflictError);
    await expect(
      complete(
        A,
        attempt,
        bundleWith("synthetic-access-a-expired", { expiresAt: now - 1 }),
      ),
    ).rejects.toBeInstanceOf(UserIntegrationGrantConflictError);
    expect(writeSpy).not.toHaveBeenCalled();
    const row = await rowOf(attempt.grantId);
    expect(row.status).toBe("pending");
    expect(row.token_secret_key).toBeNull();
  });

  it("20 denies resolution when org membership is revoked after authorization but before the vault read completes", async () => {
    const { attempt } = await connect(A);
    state.hooks.beforeVaultRead = async () => {
      resetHooks();
      await pg.query(
        "UPDATE org_members SET federation_removal_pending_at = ? WHERE org_id = ? AND LOWER(email) = ?",
        [1, "org-1", "same@example.test"],
      );
    };
    await expect(resolve(A, attempt.grantId)).rejects.toBeInstanceOf(
      UserIntegrationGrantUnavailableError,
    );
  });
});
