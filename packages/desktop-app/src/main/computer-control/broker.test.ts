import { describe, expect, it, vi } from "vitest";

import { ComputerControlBroker } from "./broker";
import type { DesktopHelper } from "./helper-client";
import { ComputerControlPolicyError } from "./policy";
import type { MutationOperation, SemanticSnapshot } from "./types";

const snapshot: SemanticSnapshot = {
  snapshotId: "snapshot-1",
  bundleId: "com.google.Chrome",
  origin: "https://example.com",
  capturedAt: "2026-07-10T00:00:00.000Z",
  nodes: [{ id: "button-1", role: "AXButton", title: "Submit" }],
};

function createHelper(overrides: Partial<DesktopHelper> = {}): DesktopHelper & {
  snapshot: ReturnType<typeof vi.fn>;
  mutate: ReturnType<typeof vi.fn>;
  releaseAll: ReturnType<typeof vi.fn>;
} {
  return {
    snapshot: vi.fn(async () => snapshot),
    mutate: vi.fn(async () => undefined),
    releaseAll: vi.fn(async () => undefined),
    close: vi.fn(),
    ...overrides,
  } as DesktopHelper & {
    snapshot: ReturnType<typeof vi.fn>;
    mutate: ReturnType<typeof vi.fn>;
    releaseAll: ReturnType<typeof vi.fn>;
  };
}

function operation(
  token: string,
  updates: Partial<MutationOperation> = {},
): MutationOperation {
  return {
    kind: "input.click",
    taskId: "task-1",
    leaseToken: token,
    target: {
      snapshotId: "snapshot-1",
      nodeId: "button-1",
      bundleId: "com.google.Chrome",
      origin: "https://example.com/path-is-normalized",
      expectedRole: "AXButton",
    },
    ...updates,
  } as MutationOperation;
}

async function prepare(helper = createHelper()) {
  const broker = new ComputerControlBroker({
    helper,
    now: () => 1_000,
    token: () => "lease-token",
  });
  const lease = await broker.acquireLease(
    "task-1",
    {
      bundleIds: ["com.google.Chrome"],
      origins: ["https://example.com/private"],
    },
    60_000,
  );
  await broker.execute("act", { kind: "observe.snapshot", taskId: "task-1" });
  return { broker, helper, lease };
}

describe("ComputerControlBroker", () => {
  it("fails closed with setup guidance when Accessibility is unavailable", async () => {
    const helper = createHelper();
    const broker = new ComputerControlBroker({
      helper,
      permissionStatus: () => ({
        screenRecording: "granted",
        accessibility: false,
      }),
    });

    await expect(
      broker.execute("act", { kind: "observe.snapshot", taskId: "task-1" }),
    ).rejects.toThrow("System Settings");
    expect(helper.snapshot).not.toHaveBeenCalled();
  });

  it("blocks every mutation in Plan mode before the helper runs", async () => {
    const { broker, helper, lease } = await prepare();

    await expect(
      broker.execute("plan", operation(lease.token)),
    ).rejects.toMatchObject({
      code: "MUTATION_BLOCKED_IN_PLAN_MODE",
    });
    expect(helper.mutate).not.toHaveBeenCalled();
  });

  it("requires the task's unexpired lease", async () => {
    const { broker, helper } = await prepare();

    await expect(
      broker.execute("act", operation("wrong-token")),
    ).rejects.toMatchObject({
      code: "LEASE_REQUIRED",
    });
    expect(helper.mutate).not.toHaveBeenCalled();
  });

  it("revalidates the exact bundle, origin, snapshot, node, and role", async () => {
    const { broker, helper, lease } = await prepare();
    const cases: MutationOperation[] = [
      operation(lease.token, {
        target: {
          ...operation(lease.token).target,
          bundleId: "com.apple.TextEdit",
        },
      }),
      operation(lease.token, {
        target: {
          ...operation(lease.token).target,
          origin: "https://attacker.example",
        },
      }),
      operation(lease.token, {
        target: { ...operation(lease.token).target, snapshotId: "old" },
      }),
      operation(lease.token, {
        target: { ...operation(lease.token).target, nodeId: "missing" },
      }),
      operation(lease.token, {
        target: {
          ...operation(lease.token).target,
          expectedRole: "AXTextField",
        },
      }),
    ];

    for (const candidate of cases) {
      await expect(broker.execute("act", candidate)).rejects.toBeInstanceOf(
        ComputerControlPolicyError,
      );
    }
    expect(helper.mutate).not.toHaveBeenCalled();
  });

  it("passes normalized scope to the helper for atomic focus revalidation", async () => {
    const { broker, helper, lease } = await prepare();
    await broker.execute("act", operation(lease.token));

    expect(helper.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "input.click" }),
      {
        bundleIds: ["com.google.Chrome"],
        origins: ["https://example.com"],
      },
      expect.any(AbortSignal),
    );
  });

  it("kill releases inputs immediately and invalidates queued actions", async () => {
    let rejectActive: ((error: Error) => void) | undefined;
    const helper = createHelper({
      mutate: vi.fn(
        async (_operation: MutationOperation, _scope, signal?: AbortSignal) =>
          new Promise<void>((_resolve, reject) => {
            rejectActive = reject;
            signal?.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              {
                once: true,
              },
            );
          }),
      ),
    });
    const { broker, lease } = await prepare(helper);
    const active = broker.execute("act", operation(lease.token));
    const queued = broker.execute("act", operation(lease.token));
    await vi.waitFor(() => expect(helper.mutate).toHaveBeenCalledTimes(1));

    await broker.kill("task-1");

    expect(helper.releaseAll).toHaveBeenCalledTimes(1);
    await expect(active).rejects.toThrow("aborted");
    await expect(queued).rejects.toMatchObject({ code: "CONTROL_CANCELLED" });
    expect(helper.mutate).toHaveBeenCalledTimes(1);
    rejectActive?.(new Error("cleanup"));
  });

  it("redacts typed text and lease tokens from audit metadata", async () => {
    const helper = createHelper();
    const audit = vi.fn();
    const broker = new ComputerControlBroker({
      helper,
      audit,
      now: () => 1_000,
      token: () => "super-secret-lease-token",
    });
    const lease = await broker.acquireLease(
      "task-1",
      { bundleIds: ["com.google.Chrome"], origins: ["https://example.com"] },
      60_000,
    );
    await broker.execute("act", { kind: "observe.snapshot", taskId: "task-1" });
    await broker.execute("act", {
      ...operation(lease.token),
      kind: "input.type",
      text: "do-not-record-this",
    });

    const serialized = JSON.stringify(audit.mock.calls);
    expect(serialized).not.toContain("do-not-record-this");
    expect(serialized).not.toContain("super-secret-lease-token");
    expect(serialized).toContain('"inputLength":18');
  });
});
