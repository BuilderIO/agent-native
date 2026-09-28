import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  patches: [] as Record<string, unknown>[],
  selectRows: [] as unknown[][],
}));
const mockAssertAccess = vi.hoisted(() => vi.fn());
const mockWriteAppState = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", () => ({
  defineAction: (options: unknown) => options,
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
}));

vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ column, value }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: async () => state.selectRows.shift() ?? [],
      }),
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => {
        state.patches.push(patch);
        return { where: async () => undefined };
      },
    }),
  }),
  schema: { recordings: { id: "recordings.id" } },
}));

vi.mock("../server/lib/recordings.js", () => ({
  nanoid: () => "tag-id",
  stringifySpaceIds: JSON.stringify,
}));

vi.mock("../server/lib/share-password.js", () => ({
  encryptSharePassword: (value: string | null | undefined) =>
    value ? "encrypted-value" : null,
}));

import action from "./update-recording";

function recording(overrides: Record<string, unknown> = {}) {
  return {
    id: "recording-1",
    organizationId: "org-1",
    sharePasswordVersion: "initial",
    ...overrides,
  };
}

async function run(args: Record<string, unknown>) {
  return action.run(action.schema.parse(args));
}

beforeEach(() => {
  vi.clearAllMocks();
  state.patches = [];
  state.selectRows = [[recording()], [recording()]];
  mockAssertAccess.mockResolvedValue(undefined);
  mockWriteAppState.mockResolvedValue(undefined);
});

describe("update-recording share password version", () => {
  it("rotates the version when a password is set", async () => {
    await run({ id: "recording-1", password: "example-share-value" });

    expect(state.patches[0]).toMatchObject({
      password: "encrypted-value",
      sharePasswordVersion: expect.any(String),
    });
    expect(state.patches[0]?.sharePasswordVersion).not.toBe("initial");
  });

  it("rotates the version when a password is cleared", async () => {
    await run({ id: "recording-1", password: null });

    expect(state.patches[0]).toMatchObject({
      password: null,
      sharePasswordVersion: expect.any(String),
    });
    expect(state.patches[0]?.sharePasswordVersion).not.toBe("initial");
  });

  it("preserves the version for metadata edits", async () => {
    await run({ id: "recording-1", title: "Updated title" });

    expect(state.patches[0]).toMatchObject({ title: "Updated title" });
    expect(state.patches[0]).not.toHaveProperty("sharePasswordVersion");
  });
});
