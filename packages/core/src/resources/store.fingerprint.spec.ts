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

vi.mock("../db/client.js", () => ({
  getDbExec: () => sharedClient,
  isProductionServerlessFunctionRuntime: () => false,
  retryOnDdlRace: <T>(fn: () => Promise<T>) => fn(),
}));

interface FrameworkClient {
  execute(arg: string | { sql: string; args: any[] }): Promise<{
    rows: any[];
    rowsAffected: number;
  }>;
  transaction?<T>(fn: (tx: FrameworkClient) => Promise<T>): Promise<T>;
}

function frameworkClientFor(client: any): FrameworkClient {
  return {
    async execute(arg) {
      const sql = typeof arg === "string" ? arg : arg.sql;
      const args = typeof arg === "string" ? [] : (arg.args ?? []);
      let parameter = 0;
      const postgresSql = sql.replace(/\?/g, () => `$${++parameter}`);
      const result = await client.query(postgresSql, args);
      return {
        rows: Array.from(result.rows ?? []),
        rowsAffected: result.affectedRows ?? result.rowCount ?? 0,
      };
    },
    transaction: (fn) =>
      client.transaction((tx: any) => fn(frameworkClientFor(tx))),
  };
}

let pglite: Awaited<ReturnType<typeof createTestPglite>>;
let sharedClient: FrameworkClient = {
  async execute() {
    return { rows: [], rowsAffected: 0 };
  },
};

beforeAll(async () => {
  pglite = await createTestPglite();
  sharedClient = frameworkClientFor(pglite.db);
});

afterAll(async () => {
  await pglite.close();
});

let now = 1_700_000_000_000;

beforeEach(() => {
  vi.spyOn(Date, "now").mockImplementation(() => (now += 1_000));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resourceFingerprintAllOwners", () => {
  it("changes on every kind of write under the prefix and on nothing else", async () => {
    const {
      resourceDeleteByPath,
      resourceFingerprintAllOwners,
      resourceGetByPath,
      resourcePut,
      resourceRestoreSnapshotIfCurrent,
    } = await import("./store.js");
    const prefix = `jobs/fingerprint-${Date.now()}/`;
    const owner = "alice+fingerprint@agent-native.test";
    const seen = new Set<string>();
    const expectChanged = async () => {
      const fingerprint = await resourceFingerprintAllOwners(prefix);
      expect(seen.has(fingerprint)).toBe(false);
      seen.add(fingerprint);
      return fingerprint;
    };

    await expectChanged();
    await resourcePut(owner, `${prefix}a.md`, "first");
    await expectChanged();
    await resourcePut(
      "bob+fingerprint@agent-native.test",
      `${prefix}b.md`,
      "x",
    );
    await expectChanged();
    const snapshot = await resourceGetByPath(owner, `${prefix}a.md`);

    // Editing the row that is not the newest leaves MAX(updated_at) alone.
    await resourcePut(owner, `${prefix}a.md`, "second");
    const edited = await expectChanged();
    await resourceRestoreSnapshotIfCurrent(
      snapshot!,
      await resourceGetByPath(owner, `${prefix}a.md`),
    );
    expect(await resourceFingerprintAllOwners(prefix)).not.toBe(edited);

    const beforeUnrelated = await resourceFingerprintAllOwners(prefix);
    await resourcePut(owner, "notes/unrelated.md", "elsewhere");
    expect(await resourceFingerprintAllOwners(prefix)).toBe(beforeUnrelated);

    await resourceDeleteByPath(owner, `${prefix}a.md`);
    expect(await resourceFingerprintAllOwners(prefix)).not.toBe(
      beforeUnrelated,
    );
  });

  it("changes on a same-size edit in the same millisecond", async () => {
    const { resourceFingerprintAllOwners, resourcePut } =
      await import("./store.js");
    vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    const prefix = `jobs/same-ms-${Math.random().toString(36).slice(2)}/`;
    const owner = "alice+same-ms@agent-native.test";
    await resourcePut(owner, `${prefix}a.md`, "enabled: false");
    const before = await resourceFingerprintAllOwners(prefix);

    await resourcePut(owner, `${prefix}a.md`, "enabled: truee");

    expect(await resourceFingerprintAllOwners(prefix)).not.toBe(before);
  });

  it("does not change when nothing was written", async () => {
    const { resourceFingerprintAllOwners, resourcePut } =
      await import("./store.js");
    const prefix = `jobs/stable-${Date.now()}/`;
    await resourcePut("alice+stable@agent-native.test", `${prefix}a.md`, "x");

    expect(await resourceFingerprintAllOwners(prefix)).toBe(
      await resourceFingerprintAllOwners(prefix),
    );
  });
});
