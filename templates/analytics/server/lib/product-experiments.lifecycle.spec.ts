import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => vi.fn());
const targetMock = vi.hoisted(() => vi.fn());
const setTargetMock = vi.hoisted(() => vi.fn());
const withFeatureFlagMutationLockMock = vi.hoisted(() =>
  vi.fn(
    async (
      _admin: unknown,
      _target: unknown,
      operation: () => Promise<unknown>,
    ) => operation(),
  ),
);

vi.mock("../db/index.js", () => ({
  getDb: dbMock,
  schema: {
    productExperiments: new Proxy({}, { get: (_target, key) => String(key) }),
    analyticsEvents: new Proxy({}, { get: (_target, key) => String(key) }),
  },
}));
vi.mock("./feature-flag-mutation-lock.js", () => ({
  withFeatureFlagMutationLock: withFeatureFlagMutationLockMock,
}));
vi.mock("./workspace-feature-flags.js", () => ({
  getWorkspaceFlagTarget: targetMock,
  setWorkspaceFeatureFlag: setTargetMock,
}));

import {
  manageProductExperiment,
  reconcileProductExperiment,
  startProductExperiment,
} from "./product-experiments.js";

const admin = {
  userEmail: "operator@example.com",
  orgId: "org-1",
  role: "owner" as const,
};
const running = {
  id: "11111111-1111-4111-8111-111111111111",
  status: "running",
  appId: "mail",
  appOrigin: "https://mail.example.com",
  flagKey: "beta",
  primaryEventName: "converted",
  treatmentPercentage: 50,
  rolloutEpoch: "epoch-1",
  startedAt: "2026-01-01T00:00:00Z",
  endedAt: null,
  orgId: "org-1",
  ownerEmail: "operator@example.com",
};

function installDb(
  rows: unknown[][],
  order: string[],
  options: { updateError?: Error; returningRows?: unknown[] } = {},
) {
  const update = () => ({
    set: () => ({
      where: () => {
        order.push("db-write");
        if (options.updateError) throw options.updateError;
        return {
          returning: async () => options.returningRows ?? [{ id: "updated" }],
        };
      },
    }),
  });
  dbMock.mockReturnValue({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => rows.shift() ?? [],
          orderBy: () => ({ limit: async () => [] }),
        }),
      }),
    }),
    update,
    insert: () => ({ values: async () => undefined }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("product experiment lifecycle", () => {
  it("starts target-first and rejects another running experiment", async () => {
    const order: string[] = [];
    installDb(
      [
        [{ ...running, status: "draft", rolloutEpoch: null }],
        [],
        [{ ...running, status: "draft", rolloutEpoch: null }],
        [],
        [running],
      ],
      order,
    );
    targetMock.mockResolvedValue({
      appId: "mail",
      appOrigin: "https://mail.example.com",
      state: "ready",
      flags: [{ key: "beta" }],
    });
    setTargetMock.mockImplementation(async () => {
      order.push("target-write");
    });
    await startProductExperiment(admin, running.id);
    expect(order).toEqual(["target-write", "db-write"]);
    installDb(
      [
        [{ ...running, status: "draft", rolloutEpoch: null }],
        [{ id: "other" }],
      ],
      [],
    );
    await expect(startProductExperiment(admin, running.id)).rejects.toThrow(
      "Another running experiment",
    );
    expect(setTargetMock).toHaveBeenCalledTimes(1);
  });

  it("turns the target off when the running-state write fails", async () => {
    installDb(
      [
        [{ ...running, status: "draft", rolloutEpoch: null }],
        [],
        [{ ...running, status: "draft", rolloutEpoch: null }],
        [],
      ],
      [],
      { updateError: new Error("db unavailable") },
    );
    targetMock.mockResolvedValue({
      appId: "mail",
      appOrigin: "https://mail.example.com",
      state: "ready",
      flags: [{ key: "beta" }],
    });
    setTargetMock.mockResolvedValue({ contractVersion: 1, status: "ready" });
    await expect(startProductExperiment(admin, running.id)).rejects.toThrow(
      "target rollout was turned off again",
    );
    expect(setTargetMock).toHaveBeenNthCalledWith(
      2,
      admin,
      expect.objectContaining({ operation: "off" }),
    );
  });

  it("keeps completed experiment definitions immutable", async () => {
    installDb([[{ ...running, status: "completed" }]], []);
    await expect(
      manageProductExperiment(admin, {
        operation: "update",
        id: running.id,
        experiment: { primaryEventName: "rewritten" },
      }),
    ).rejects.toThrow("Only draft experiments");
  });

  it("fails a draft update that loses the atomic status predicate", async () => {
    installDb(
      [[{ ...running, status: "draft" }], [{ ...running, status: "draft" }]],
      [],
      { returningRows: [] },
    );
    await expect(
      manageProductExperiment(admin, {
        operation: "update",
        id: running.id,
        experiment: { primaryEventName: "rewritten" },
      }),
    ).rejects.toThrow("started changing");
  });

  it("marks drift interrupted without mutating the target", async () => {
    const order: string[] = [];
    installDb([[running], [{ ...running, status: "interrupted" }]], order);
    targetMock.mockResolvedValue({
      appId: "mail",
      appOrigin: "https://mail.example.com",
      state: "ready",
      flags: [
        {
          key: "beta",
          rules: {
            mode: "rules",
            emails: [],
            orgIds: [],
            percentage: 25,
            rolloutEpoch: "epoch-1",
          },
        },
      ],
    });
    await reconcileProductExperiment(admin, running.id);
    expect(order).toEqual(["db-write"]);
    expect(setTargetMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "global-on mode",
      rules: {
        mode: "on",
        emails: [],
        orgIds: [],
        percentage: 50,
        rolloutEpoch: "epoch-1",
      },
    },
    {
      name: "an exact-email override",
      rules: {
        mode: "rules",
        emails: ["someone@example.com"],
        orgIds: [],
        percentage: 50,
        rolloutEpoch: "epoch-1",
      },
    },
    {
      name: "an exact-organization override",
      rules: {
        mode: "rules",
        emails: [],
        orgIds: ["org-1"],
        percentage: 50,
        rolloutEpoch: "epoch-1",
      },
    },
    {
      name: "missing email targets",
      rules: {
        mode: "rules",
        orgIds: [],
        percentage: 50,
        rolloutEpoch: "epoch-1",
      },
    },
    {
      name: "missing organization targets",
      rules: {
        mode: "rules",
        emails: [],
        percentage: 50,
        rolloutEpoch: "epoch-1",
      },
    },
    {
      name: "a changed rollout epoch",
      rules: {
        mode: "rules",
        emails: [],
        orgIds: [],
        percentage: 50,
        rolloutEpoch: "epoch-2",
      },
    },
  ])("interrupts reconciliation after $name drifts", async ({ rules }) => {
    const order: string[] = [];
    installDb([[running], [{ ...running, status: "interrupted" }]], order);
    targetMock.mockResolvedValue({
      appId: "mail",
      appOrigin: "https://mail.example.com",
      state: "ready",
      flags: [{ key: "beta", rules }],
    });

    await reconcileProductExperiment(admin, running.id);

    expect(order).toEqual(["db-write"]);
    expect(setTargetMock).not.toHaveBeenCalled();
  });

  it("keeps a running experiment healthy for its exact owned rule shape", async () => {
    const order: string[] = [];
    installDb([[running], [running]], order);
    targetMock.mockResolvedValue({
      appId: "mail",
      appOrigin: "https://mail.example.com",
      state: "ready",
      flags: [
        {
          key: "beta",
          rules: {
            mode: "rules",
            emails: [],
            orgIds: [],
            percentage: 50,
            rolloutEpoch: "epoch-1",
          },
        },
      ],
    });

    await expect(
      reconcileProductExperiment(admin, running.id),
    ).resolves.toMatchObject(running);
    expect(order).toEqual(["db-write"]);
    expect(setTargetMock).not.toHaveBeenCalled();
  });

  it("pauses and emergency-offs target-first", async () => {
    for (const operation of ["pause", "emergency-off"] as const) {
      const order: string[] = [];
      installDb(
        [[running], [running], [{ ...running, status: "paused" }]],
        order,
      );
      setTargetMock.mockImplementationOnce(async () => {
        order.push("target-write");
      });
      await manageProductExperiment(admin, { operation, id: running.id });
      expect(order).toEqual(["target-write", "db-write"]);
    }
  });

  it("leaves transient target states pending without writes", async () => {
    const order: string[] = [];
    installDb([[running]], order);
    targetMock.mockResolvedValue({
      appId: "mail",
      appOrigin: "https://mail.example.com",
      state: "unreachable",
      flags: [],
    });
    const result = await reconcileProductExperiment(admin, running.id);
    expect(result).toMatchObject({ reconciliation: "pending" });
    expect(order).toEqual([]);
    expect(setTargetMock).not.toHaveBeenCalled();
  });
});
