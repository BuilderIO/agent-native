import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

const recordMock = vi.hoisted(() => vi.fn());

vi.mock("../db/client.js", () => ({
  getDbExec: () => sharedClient,
  isProductionServerlessFunctionRuntime: () => false,
  retryOnDdlRace: <T>(fn: () => Promise<T>) => fn(),
}));
vi.mock("../audit/org-admin.js", () => ({
  recordOrgAdminAuditEvent: recordMock,
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

beforeEach(() => {
  recordMock.mockReset();
  recordMock.mockResolvedValue(undefined);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

const factoryJob = [
  "---",
  'schedule: "*/5 * * * *"',
  "enabled: true",
  "triggerType: schedule",
  "lastStatus: success",
  "source: slack",
  "slackChannelId: C123",
  "displayName: slack-feedback",
  "---",
  "",
  "Triage the channel.",
].join("\n");

// The shape a whole-file rewrite leaves behind: scheduler fields only.
const rewrittenJob = [
  "---",
  'schedule: "*/5 * * * *"',
  "enabled: true",
  "lastStatus: running",
  "---",
  "",
  "Triage the channel.",
].join("\n");

const droppedKeys = () => recordMock.mock.calls[0][0].args.droppedKeys;

describe("job file writes that lose frontmatter fields", () => {
  it("records a rewrite through resourcePut with the writer and dropped fields", async () => {
    const { organizationResourceOwner, resourceDeleteByPath, resourcePut } =
      await import("./store.js");
    const owner = organizationResourceOwner("org-1");
    const path = `jobs/factories/f-${Date.now()}/factory-slack-feedback.md`;
    try {
      await resourcePut(owner, path, factoryJob);
      expect(recordMock).not.toHaveBeenCalled();

      await resourcePut(owner, path, rewrittenJob);

      expect(recordMock).toHaveBeenCalledTimes(1);
      expect(recordMock.mock.calls[0][0]).toMatchObject({
        action: "job-fields-dropped",
        targetId: path,
        orgId: "org-1",
        args: { writer: "resourcePut" },
      });
      expect(droppedKeys()).toEqual([
        "triggerType",
        "source",
        "slackChannelId",
        "displayName",
      ]);
    } finally {
      await resourceDeleteByPath(owner, path);
    }
  });

  it("records a rewrite through resourcePutIfCurrent", async () => {
    const {
      organizationResourceOwner,
      resourceDeleteByPath,
      resourceGetByPath,
      resourcePut,
      resourcePutIfCurrent,
    } = await import("./store.js");
    const owner = organizationResourceOwner("org-1");
    const path = `jobs/factories/f-${Date.now()}/factory-pr-babysit.md`;
    try {
      await resourcePut(owner, path, factoryJob);
      const current = await resourceGetByPath(owner, path);

      const written = await resourcePutIfCurrent({
        owner,
        path,
        content: rewrittenJob,
        expectedId: current!.id,
        expectedUpdatedAt: current!.updatedAt,
        expectedContent: current!.content,
      });

      expect(written?.content).toBe(rewrittenJob);
      expect(recordMock).toHaveBeenCalledTimes(1);
      expect(recordMock.mock.calls[0][0].args.writer).toBe(
        "resourcePutIfCurrent",
      );
    } finally {
      await resourceDeleteByPath(owner, path);
    }
  });

  it.each([true, false])(
    "records transactional conditional field loss only after commit (commit=%s)",
    async (commit) => {
      const store = await import("./store.js");
      const owner = store.organizationResourceOwner("org-1");
      const path = `jobs/factories/f-${Date.now()}/transaction-${commit}.md`;
      const interrupted = new Error("admission interrupted");
      try {
        const current = await store.resourcePut(owner, path, factoryJob);
        const admission = sharedClient.transaction!(async (tx) => {
          const written = await store.resourcePutIfCurrentInTransaction(
            {
              owner,
              path,
              content: rewrittenJob,
              expectedId: current.id,
              expectedUpdatedAt: current.updatedAt,
              expectedContent: current.content,
            },
            tx,
          );
          expect(written).not.toBeNull();
          expect(recordMock).not.toHaveBeenCalled();
          if (!commit) throw interrupted;
          return written!;
        });
        if (commit) {
          const written = await admission;
          expect(recordMock).not.toHaveBeenCalled();
          await written.notify();
          expect(recordMock).toHaveBeenCalledTimes(1);
          expect(recordMock.mock.calls[0][0].args.writer).toBe(
            "resourcePutIfCurrent",
          );
        } else {
          await expect(admission).rejects.toBe(interrupted);
          expect(recordMock).not.toHaveBeenCalled();
        }
        await expect(
          store.resourceGetByPath(owner, path),
        ).resolves.toMatchObject({
          content: commit ? rewrittenJob : factoryJob,
        });
      } finally {
        await store.resourceDeleteByPath(owner, path);
      }
    },
  );

  it("records a rewrite through resourcePutIfSnapshot", async () => {
    const {
      organizationResourceOwner,
      resourceDeleteByPath,
      resourceGetByPath,
      resourcePut,
      resourcePutIfSnapshot,
    } = await import("./store.js");
    const owner = organizationResourceOwner("org-1");
    const path = `jobs/factories/f-${Date.now()}/factory-sentry-errors.md`;
    try {
      await resourcePut(owner, path, factoryJob);
      const previous = await resourceGetByPath(owner, path);

      const written = await resourcePutIfSnapshot({
        previous,
        owner,
        path,
        content: rewrittenJob,
      });

      expect(written?.resource.content).toBe(rewrittenJob);
      expect(recordMock).toHaveBeenCalledTimes(1);
      expect(recordMock.mock.calls[0][0].args.writer).toBe(
        "resourcePutIfSnapshot",
      );
    } finally {
      await resourceDeleteByPath(owner, path);
    }
  });

  it("stays silent for the scheduler's status patch and for non-job files", async () => {
    const {
      SHARED_OWNER,
      organizationResourceOwner,
      resourceDeleteByPath,
      resourcePut,
    } = await import("./store.js");
    const owner = organizationResourceOwner("org-1");
    const jobPath = `jobs/factories/f-${Date.now()}/factory-slack-feedback.md`;
    const notePath = `notes/rewrite-${Date.now()}.md`;
    try {
      await resourcePut(owner, jobPath, factoryJob);
      await resourcePut(
        owner,
        jobPath,
        factoryJob.replace("lastStatus: success", "lastStatus: running"),
      );
      await resourcePut(SHARED_OWNER, notePath, factoryJob);
      await resourcePut(SHARED_OWNER, notePath, "plain note");

      expect(recordMock).not.toHaveBeenCalled();
    } finally {
      await resourceDeleteByPath(owner, jobPath);
      await resourceDeleteByPath(SHARED_OWNER, notePath);
    }
  });

  it("still completes the write when the audit store fails", async () => {
    recordMock.mockRejectedValue(new Error("audit store down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const {
      organizationResourceOwner,
      resourceDeleteByPath,
      resourceGetByPath,
      resourcePut,
    } = await import("./store.js");
    const owner = organizationResourceOwner("org-1");
    const path = `jobs/factories/f-${Date.now()}/factory-slack-feedback.md`;
    try {
      await resourcePut(owner, path, factoryJob);
      await resourcePut(owner, path, rewrittenJob);

      await expect(resourceGetByPath(owner, path)).resolves.toMatchObject({
        content: rewrittenJob,
      });
    } finally {
      await resourceDeleteByPath(owner, path);
    }
  });

  describe("snapshot batches", () => {
    const setup = async () => {
      const store = await import("./store.js");
      const owner = store.organizationResourceOwner("org-1");
      const stamp = `${Date.now()}-${Math.random()}`;
      const paths = [
        `jobs/factories/f-${stamp}/factory-slack-feedback.md`,
        `jobs/factories/f-${stamp}/factory-pr-babysit.md`,
      ] as const;
      for (const path of paths)
        await store.resourcePut(owner, path, factoryJob);
      const previous = await Promise.all(
        paths.map((path) => store.resourceGetByPath(owner, path)),
      );
      recordMock.mockClear();
      return { store, owner, paths, previous };
    };

    it("records each rewrite once the whole batch has committed", async () => {
      const { store, owner, paths, previous } = await setup();
      try {
        const written = await store.resourcePutSnapshotBatchIfCurrent([
          {
            previous: previous[0]!,
            owner,
            path: paths[0],
            content: rewrittenJob,
          },
          {
            previous: previous[1]!,
            owner,
            path: paths[1],
            content: rewrittenJob,
          },
        ]);

        expect(written).toHaveLength(2);
        expect(recordMock).toHaveBeenCalledTimes(2);
        expect(
          recordMock.mock.calls.map(([event]) => event.args.writer),
        ).toEqual([
          "resourcePutSnapshotBatchIfCurrent",
          "resourcePutSnapshotBatchIfCurrent",
        ]);
      } finally {
        for (const path of paths) await store.resourceDeleteByPath(owner, path);
      }
    });

    it("records nothing when the batch conflicts and rolls back", async () => {
      const { store, owner, paths, previous } = await setup();
      try {
        const stale = {
          ...previous[1]!,
          updatedAt: previous[1]!.updatedAt - 1,
        };
        const written = await store.resourcePutSnapshotBatchIfCurrent([
          {
            previous: previous[0]!,
            owner,
            path: paths[0],
            content: rewrittenJob,
          },
          { previous: stale, owner, path: paths[1], content: rewrittenJob },
        ]);

        expect(written).toBeNull();
        expect(recordMock).not.toHaveBeenCalled();
        await expect(
          store.resourceGetByPath(owner, paths[0]),
        ).resolves.toMatchObject({ content: factoryJob });
      } finally {
        for (const path of paths) await store.resourceDeleteByPath(owner, path);
      }
    });
  });
});
