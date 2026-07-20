import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core", () => ({
  defineAction: (action: unknown) => action,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: vi.fn(),
  schema: { brainSources: { id: "brainSources.id" } },
}));

vi.mock("../server/lib/brain.js", () => ({
  nowIso: vi.fn(),
  parseJson: vi.fn(),
  serializeSource: vi.fn(),
  stableJson: vi.fn(),
}));

vi.mock("../server/lib/source-credentials.js", () => ({
  assertSourceWorkspaceConnectionAvailable: vi.fn(),
}));

import { optionalJsonRecordSchema, parseJsonCliInput } from "./_schemas.js";
import updateSourceAction from "./update-source.js";

describe("Brain JSON action inputs", () => {
  it("preserves records and ordinary strings", () => {
    const record = { includePublicChannels: true };

    expect(parseJsonCliInput(record)).toBe(record);
    expect(parseJsonCliInput("not-json")).toBe("not-json");
  });

  it("accepts a double-stringified optional JSON record", () => {
    const config = {
      includePublicChannels: true,
      maxChannelsPerSync: 10,
    };

    expect(
      optionalJsonRecordSchema.parse(JSON.stringify(JSON.stringify(config))),
    ).toEqual(config);
  });

  it("keeps nested unwrapping bounded", () => {
    const tripleStringified = JSON.stringify(
      JSON.stringify(JSON.stringify({ autoSync: true })),
    );

    expect(optionalJsonRecordSchema.safeParse(tripleStringified).success).toBe(
      false,
    );
  });

  it("accepts double-stringified config through update-source", () => {
    const config = {
      includePublicChannels: true,
      oldest: "2026-04-20T00:00:00.000Z",
    };

    const actionSchema = (
      updateSourceAction as unknown as {
        schema: { parse: (value: unknown) => { config?: unknown } };
      }
    ).schema;
    const parsed = actionSchema.parse({
      id: "source-slack",
      config: JSON.stringify(JSON.stringify(config)),
    });

    expect(parsed.config).toEqual(config);
  });
});
