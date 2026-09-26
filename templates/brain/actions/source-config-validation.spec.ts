import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  createSource: vi.fn(),
  getCredentialContext: vi.fn(() => ({})),
  nanoid: vi.fn(() => "generated"),
  nowIso: vi.fn(() => "2026-07-22T00:00:00.000Z"),
  parseJson: vi.fn(() => ({})),
  serializeSource: vi.fn((source: { id: string }) => ({ id: source.id })),
  sha256Hex: vi.fn(async (value: string) => `hash:${value}`),
  stableJson: vi.fn((value: unknown) => JSON.stringify(value)),
  assertSourceCredentialAvailable: vi.fn(),
  assertSourceWorkspaceConnectionAvailable: vi.fn(),
}));

vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
  defineAction: (action: unknown) => action,
}));

vi.mock("@agent-native/core/server", () => ({
  getCredentialContext: mocks.getCredentialContext,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("drizzle-orm", () => ({ eq: vi.fn(() => "where") }));

const set = vi.fn(() => ({ where: vi.fn() }));
const limit = vi.fn(async () => [{ id: "source-1" }]);
const select = vi.fn(() => ({
  from: vi.fn(() => ({ where: vi.fn(() => ({ limit })) })),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({ update: vi.fn(() => ({ set })), select }),
  schema: { brainSources: { id: "brainSources.id" } },
}));

vi.mock("../server/lib/brain.js", () => mocks);
vi.mock("../server/lib/source-credentials.js", () => mocks);

import createSourceAction from "./create-source.js";
import updateSourceAction from "./update-source.js";

type ActionRun = { run: (args: Record<string, unknown>) => Promise<unknown> };

const createSource = createSourceAction as unknown as ActionRun;
const updateSource = updateSourceAction as unknown as ActionRun;

const GARBLED_PASTE = "http://slack.com/channel](http://slack.com/channel)";

describe("create-source config validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSource.mockResolvedValue({ id: "source-1" });
  });

  it("refuses to create a Slack source from a malformed channel entry", async () => {
    await expect(
      createSource.run({
        title: "Slack knowledge channels",
        provider: "slack",
        visibility: "private",
        config: { channelIds: [GARBLED_PASTE] },
      }),
    ).rejects.toMatchObject({ errorCode: "invalid_source_config" });

    expect(mocks.createSource).not.toHaveBeenCalled();
  });

  it("surfaces a readable 400 rather than a generic failure", async () => {
    await expect(
      createSource.run({
        title: "Slack knowledge channels",
        provider: "slack",
        visibility: "private",
        config: { channelIds: [GARBLED_PASTE] },
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: "invalid_source_config",
    });
  });

  it("names the offending entry and the accepted format", async () => {
    await expect(
      createSource.run({
        title: "Slack knowledge channels",
        provider: "slack",
        visibility: "private",
        config: { channelIds: [GARBLED_PASTE] },
      }),
    ).rejects.toThrow(/C0123456789/);
  });

  it("refuses to create a GitHub source from a non-repository entry", async () => {
    await expect(
      createSource.run({
        title: "Repos",
        provider: "github",
        visibility: "private",
        config: { repositories: ["agent-native"] },
      }),
    ).rejects.toMatchObject({ errorCode: "invalid_source_config" });

    expect(mocks.createSource).not.toHaveBeenCalled();
  });

  it("refuses entries the storage readers would have silently dropped", async () => {
    for (const config of [
      { channelIds: [""] },
      { channelIds: ["#"] },
      { channelIds: ["   "] },
      { channelIds: [123] },
    ]) {
      await expect(
        createSource.run({
          title: "Slack knowledge channels",
          provider: "slack",
          visibility: "private",
          config,
        }),
        JSON.stringify(config),
      ).rejects.toMatchObject({ errorCode: "invalid_source_config" });
    }

    expect(mocks.createSource).not.toHaveBeenCalled();
  });

  it("refuses a Slack DM id, which can never yield an eligible channel", async () => {
    await expect(
      createSource.run({
        title: "Slack knowledge channels",
        provider: "slack",
        visibility: "private",
        config: { channelIds: ["D0123456789"] },
      }),
    ).rejects.toThrow(/DMs/);

    expect(mocks.createSource).not.toHaveBeenCalled();
  });

  it("still creates a source from valid input", async () => {
    await expect(
      createSource.run({
        title: "Slack knowledge channels",
        provider: "slack",
        visibility: "private",
        config: { channelIds: ["C0123456789", "product"], pollMinutes: 60 },
      }),
    ).resolves.toEqual({ source: { id: "source-1" }, ingestToken: undefined });

    expect(mocks.createSource).toHaveBeenCalledTimes(1);
  });
});

describe("update-source config validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertAccess.mockResolvedValue({
      resource: {
        id: "source-1",
        provider: "slack",
        configJson: "{}",
        status: "active",
      },
    });
  });

  it("refuses to save a malformed channel entry onto an existing source", async () => {
    await expect(
      updateSource.run({
        id: "source-1",
        config: { channelIds: [GARBLED_PASTE] },
      }),
    ).rejects.toMatchObject({ errorCode: "invalid_source_config" });

    expect(set).not.toHaveBeenCalled();
  });

  it("does not re-litigate stored bad data when an unrelated field changes", async () => {
    await expect(
      updateSource.run({ id: "source-1", config: { pollMinutes: 30 } }),
    ).resolves.toBeDefined();
  });
});
