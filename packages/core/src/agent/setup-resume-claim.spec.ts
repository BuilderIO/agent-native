import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => new Map<string, string>());
const afterListing = vi.hoisted(() => ({
  run: undefined as undefined | (() => Promise<void>),
}));

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
  listSettingsByPrefix: async (prefix: string) => {
    const rows = [...store]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => ({ key, value: JSON.parse(value) }));
    // A request that takes a key over between the listing and the delete.
    await afterListing.run?.();
    return rows;
  },
  deleteSettingIfValue: async (
    key: string,
    expected: Record<string, unknown>,
  ) => {
    if (store.get(key) !== JSON.stringify(expected)) return false;
    return store.delete(key);
  },
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
const prefix = "agent-chat-setup-resume:alice@example.com:thread-1:";

beforeEach(() => {
  store.clear();
  afterListing.run = undefined;
});

describe("claimSetupResume", () => {
  it("lets the first resume of a refused run through and refuses the next tab", async () => {
    expect(await claimSetupResume({ ...refused, turnId: "tab-1" })).toEqual({
      release: expect.any(Function),
    });
    expect(await claimSetupResume({ ...refused, turnId: "tab-2" })).toBeNull();
  });

  it("lets the claiming turn through again and keeps other refused runs separate", async () => {
    await claimSetupResume({ ...refused, turnId: "tab-1" });

    expect(
      await claimSetupResume({ ...refused, turnId: "tab-1" }),
    ).not.toBeNull();
    expect(
      await claimSetupResume({
        ...refused,
        refusedRunId: "run-other",
        turnId: "tab-2",
      }),
    ).not.toBeNull();
  });

  it("claims one winner when two tabs resume at once", async () => {
    const results = await Promise.all([
      claimSetupResume({ ...refused, turnId: "tab-1" }),
      claimSetupResume({ ...refused, turnId: "tab-2" }),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("gives the claim back so a later resend is not refused", async () => {
    const claim = await claimSetupResume({ ...refused, turnId: "tab-1" });
    await claim!.release();

    expect(
      await claimSetupResume({ ...refused, turnId: "tab-2" }),
    ).not.toBeNull();
  });

  it("never releases a claim another turn holds", async () => {
    const claim = await claimSetupResume({ ...refused, turnId: "tab-1" });
    store.set(
      `${prefix}run-refused`,
      JSON.stringify({ turnId: "tab-2", expiresAt: Date.now() + 60_000 }),
    );

    await claim!.release();

    expect(await claimSetupResume({ ...refused, turnId: "tab-3" })).toBeNull();
  });

  it("reclaims an expired claim and clears the expired ones for the thread", async () => {
    const expired = JSON.stringify({ turnId: "tab-old", expiresAt: 1 });
    store.set(`${prefix}run-refused`, expired);
    store.set(`${prefix}run-stale`, expired);

    expect(
      await claimSetupResume({ ...refused, turnId: "tab-2" }),
    ).not.toBeNull();

    expect([...store.keys()]).toEqual([`${prefix}run-refused`]);
  });

  it("does not sweep away a claim another request takes over mid-sweep", async () => {
    const expired = JSON.stringify({ turnId: "tab-old", expiresAt: 1 });
    store.set(`${prefix}run-stale`, expired);
    const live = JSON.stringify({
      turnId: "tab-2",
      expiresAt: Date.now() + 60_000,
    });
    afterListing.run = async () => {
      // The stale key is reclaimed after it was listed as expired.
      store.set(`${prefix}run-stale`, live);
    };

    await claimSetupResume({ ...refused, turnId: "tab-1" });

    expect(store.get(`${prefix}run-stale`)).toBe(live);
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
