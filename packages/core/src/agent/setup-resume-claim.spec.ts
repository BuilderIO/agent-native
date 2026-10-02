import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => new Map<string, string>());

vi.mock("../settings/store.js", () => ({
  // The same compare-and-set the real store runs: one writer wins a key.
  mutateSetting: async (
    key: string,
    updater: (
      current: Record<string, unknown> | null,
    ) => Record<string, unknown> | Promise<Record<string, unknown>>,
  ) => {
    for (;;) {
      const raw = store.get(key) ?? null;
      const next = await updater(raw === null ? null : JSON.parse(raw));
      await Promise.resolve();
      if ((store.get(key) ?? null) === raw) {
        store.set(key, JSON.stringify(next));
        return next;
      }
    }
  },
  listSettingsByPrefix: async (prefix: string) =>
    [...store]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => ({ key, value: JSON.parse(value) })),
  deleteSetting: async (key: string) => store.delete(key),
}));

import {
  claimSetupResume,
  setupResumeRefusedRunId,
} from "./setup-resume-claim.js";

const refused = {
  ownerEmail: "alice@example.com",
  threadId: "thread-1",
  refusedRunId: "run-refused",
};

beforeEach(() => {
  store.clear();
});

describe("claimSetupResume", () => {
  it("lets the first resume of a refused run through and refuses the next tab", async () => {
    await expect(
      claimSetupResume({ ...refused, turnId: "tab-1" }),
    ).resolves.toBe(true);
    await expect(
      claimSetupResume({ ...refused, turnId: "tab-2" }),
    ).resolves.toBe(false);
  });

  it("lets the claiming turn through again and keeps other refused runs separate", async () => {
    await claimSetupResume({ ...refused, turnId: "tab-1" });

    await expect(
      claimSetupResume({ ...refused, turnId: "tab-1" }),
    ).resolves.toBe(true);
    await expect(
      claimSetupResume({
        ...refused,
        refusedRunId: "run-other",
        turnId: "tab-2",
      }),
    ).resolves.toBe(true);
  });

  it("claims one winner when two tabs resume at once", async () => {
    const results = await Promise.all([
      claimSetupResume({ ...refused, turnId: "tab-1" }),
      claimSetupResume({ ...refused, turnId: "tab-2" }),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("reclaims an expired claim and clears expired ones for the thread", async () => {
    const expired = JSON.stringify({ turnId: "tab-old", expiresAt: 1 });
    const prefix = "agent-chat-setup-resume:alice@example.com:thread-1:";
    store.set(`${prefix}run-refused`, expired);
    store.set(`${prefix}run-stale`, expired);

    await expect(
      claimSetupResume({ ...refused, turnId: "tab-2" }),
    ).resolves.toBe(true);

    expect([...store.keys()]).toEqual([`${prefix}run-refused`]);
  });
});

describe("setupResumeRefusedRunId", () => {
  it("reads the refused run only from a resume after setup", () => {
    const custom = {
      agentNativeResumeAfterSetup: true,
      agentNativeRecoveryOfRunId: " run-refused ",
    };

    expect(setupResumeRefusedRunId({ metadata: { custom } })).toBe(
      "run-refused",
    );
    expect(
      setupResumeRefusedRunId({
        metadata: {
          custom: { ...custom, agentNativeResumeAfterSetup: undefined },
        },
      }),
    ).toBeUndefined();
    expect(setupResumeRefusedRunId({})).toBeUndefined();
  });
});
