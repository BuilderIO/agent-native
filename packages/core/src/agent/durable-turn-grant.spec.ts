import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  mintDurableTurnGrant,
  reissueDurableTurnGrant,
  verifyDispatchedTurnGrant,
  type DurableTurnGrantStore,
} from "./durable-turn-grant.js";

const NOW = 1_900_000_000_000;
const initiator = {
  email: "alice@example.com",
  authUserId: "user-1",
  orgId: "org-1",
  orgScope: null,
  anonymous: false,
} as const;

let prevSecret: string | undefined;
beforeEach(() => {
  prevSecret = process.env.A2A_SECRET;
  process.env.A2A_SECRET = "test-secret-do-not-use-in-prod";
});
afterEach(() => {
  if (prevSecret === undefined) delete process.env.A2A_SECRET;
  else process.env.A2A_SECRET = prevSecret;
});

function mint(
  overrides: Partial<Parameters<typeof mintDurableTurnGrant>[0]> = {},
) {
  return mintDurableTurnGrant({
    runId: "run-1",
    turnId: "turn-1",
    initiator,
    interactive: true,
    continuation: false,
    lifetimeMs: 60_000,
    now: NOW,
    ...overrides,
  });
}

function store(
  overrides: Partial<DurableTurnGrantStore> = {},
): DurableTurnGrantStore {
  return {
    getRunTurnRef: vi.fn(async () => ({
      threadId: "thread-1",
      turnId: "turn-1",
    })),
    getTurnInitiatorByRun: vi.fn(async () => ({ ...initiator })),
    isTurnAborted: vi.fn(async () => false),
    ...overrides,
  };
}

describe("mintDurableTurnGrant", () => {
  it("signs the run, turn, initiator and expiry of a fresh interactive turn", () => {
    expect(mint()).toEqual({
      runId: "run-1",
      turnId: "turn-1",
      initiator: {
        email: "alice@example.com",
        authUserId: "user-1",
        orgId: "org-1",
        orgScope: null,
      },
      expiresAt: NOW + 60_000,
      signature: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it.each([
    ["no initiator", { initiator: undefined }],
    [
      "an anonymous initiator",
      { initiator: { ...initiator, anonymous: true } },
    ],
    ["a non-interactive turn", { interactive: false }],
    ["a continuation", { continuation: true }],
  ])("mints nothing for %s", (_label, overrides) => {
    expect(mint(overrides)).toBeUndefined();
  });

  it("fills absent initiator fields with null", () => {
    expect(
      mint({ initiator: { email: "a@example.com", anonymous: false } })
        ?.initiator,
    ).toEqual({
      email: "a@example.com",
      authUserId: null,
      orgId: null,
      orgScope: null,
    });
  });
});

describe("verifyDispatchedTurnGrant", () => {
  it("returns the grant for its own live run and turn", async () => {
    await expect(
      verifyDispatchedTurnGrant(mint(), "run-1", store(), NOW),
    ).resolves.toEqual({
      runId: "run-1",
      turnId: "turn-1",
      owner: "alice@example.com",
      expiresAt: NOW + 60_000,
    });
  });

  it.each([
    ["nothing", undefined],
    ["a string", "grant"],
    ["an array", []],
  ])("ignores %s", async (_label, candidate) => {
    const s = store();
    await expect(
      verifyDispatchedTurnGrant(candidate, "run-1", s, NOW),
    ).resolves.toBeNull();
    expect(s.getRunTurnRef).not.toHaveBeenCalled();
  });

  it.each([
    ["expired", { expiresAt: NOW }],
    ["expiry not a number", { expiresAt: "later" }],
    ["expiry not finite", { expiresAt: Number.POSITIVE_INFINITY }],
    ["another run", { runId: "run-2" }],
    ["another turn", { turnId: "turn-2" }],
    ["a bad signature", { signature: "0".repeat(64) }],
  ])("refuses a grant with %s", async (_label, patch) => {
    await expect(
      verifyDispatchedTurnGrant({ ...mint(), ...patch }, "run-1", store(), NOW),
    ).resolves.toBeNull();
  });

  it("refuses a grant for a run whose recorded initiator or turn differs", async () => {
    const grant = mint();
    await expect(
      verifyDispatchedTurnGrant(
        grant,
        "run-1",
        store({
          getTurnInitiatorByRun: async () => ({
            ...initiator,
            email: "bob@example.com",
          }),
        }),
        NOW,
      ),
    ).resolves.toBeNull();
    await expect(
      verifyDispatchedTurnGrant(
        grant,
        "run-1",
        store({
          getTurnInitiatorByRun: async () => ({
            ...initiator,
            anonymous: true,
          }),
        }),
        NOW,
      ),
    ).resolves.toBeNull();
    await expect(
      verifyDispatchedTurnGrant(
        grant,
        "run-1",
        store({ getRunTurnRef: async () => null }),
        NOW,
      ),
    ).resolves.toBeNull();
    await expect(
      verifyDispatchedTurnGrant(
        grant,
        "run-1",
        store({ getTurnInitiatorByRun: async () => null }),
        NOW,
      ),
    ).resolves.toBeNull();
  });

  it("refuses the grant of an aborted turn", async () => {
    const isTurnAborted = vi.fn(async () => true);
    await expect(
      verifyDispatchedTurnGrant(mint(), "run-1", store({ isTurnAborted }), NOW),
    ).resolves.toBeNull();
    expect(isTurnAborted).toHaveBeenCalledWith("thread-1", "turn-1");
  });
});

describe("reissueDurableTurnGrant", () => {
  const verified = {
    runId: "run-1",
    turnId: "turn-1",
    owner: "Alice@Example.com",
    expiresAt: NOW + 60_000,
  };

  it("hands the next run the same turn, initiator and expiry", async () => {
    const next = reissueDurableTurnGrant({
      verified,
      initiator,
      turnId: "turn-1",
      nextRunId: "run-2",
      now: NOW,
    });
    expect(next).toMatchObject({
      runId: "run-2",
      turnId: "turn-1",
      expiresAt: NOW + 60_000,
    });
    await expect(
      verifyDispatchedTurnGrant(next, "run-2", store(), NOW),
    ).resolves.toMatchObject({ runId: "run-2", turnId: "turn-1" });
    await expect(
      verifyDispatchedTurnGrant(next, "run-1", store(), NOW),
    ).resolves.toBeNull();
  });

  it.each([
    ["no verified grant", { verified: undefined }],
    ["no initiator", { initiator: undefined }],
    [
      "an anonymous initiator",
      { initiator: { ...initiator, anonymous: true } },
    ],
    ["another turn", { turnId: "turn-2" }],
    [
      "another person",
      { initiator: { ...initiator, email: "bob@example.com" } },
    ],
    ["an expired grant", { verified: { ...verified, expiresAt: NOW } }],
  ])("passes nothing on with %s", (_label, overrides) => {
    expect(
      reissueDurableTurnGrant({
        verified,
        initiator,
        turnId: "turn-1",
        nextRunId: "run-2",
        now: NOW,
        ...overrides,
      }),
    ).toBeUndefined();
  });
});
