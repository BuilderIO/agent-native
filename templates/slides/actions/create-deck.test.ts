import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mock dependencies BEFORE importing the action ---

const mockAssertAccess = vi.fn();
const mockWriteAppState = vi.fn();
const mockNotifyClients = vi.fn();
const mockGetUserEmail = vi.fn(() => "owner@example.com");
const mockGetOrgId = vi.fn(() => null);

let existingDeckRow: { id: string; data: string } | undefined = undefined;
let insertedRow: Record<string, unknown> | undefined = undefined;
let updatedFields: Record<string, unknown> | undefined = undefined;

// db.select().from(...).where(...).limit(...)
const limitFn = vi.fn(async () => (existingDeckRow ? [existingDeckRow] : []));
const whereSelectFn = vi.fn(() => ({ limit: limitFn }));
const fromFn = vi.fn(() => ({ where: whereSelectFn }));
const selectFn = vi.fn(() => ({ from: fromFn }));

// db.insert().values(...)
const valuesFn = vi.fn(async (row: Record<string, unknown>) => {
  insertedRow = row;
});
const insertFn = vi.fn(() => ({ values: valuesFn }));

// db.update().set(...).where(...)
const whereUpdateFn = vi.fn(async () => undefined);
const setFn = vi.fn((fields: Record<string, unknown>) => {
  updatedFields = fields;
  return { where: whereUpdateFn };
});
const updateFn = vi.fn(() => ({ set: setFn }));

const mockDb = { select: selectFn, insert: insertFn, update: updateFn };

vi.mock("../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema: {
    decks: { id: "id_col", data: "data_col", updatedAt: "ua_col" },
  },
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
}));

vi.mock("../server/handlers/decks.js", () => ({
  notifyClients: (...args: unknown[]) => mockNotifyClients(...args),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => mockGetUserEmail(),
  getRequestOrgId: () => mockGetOrgId(),
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ col, val }),
}));

import action from "./create-deck";

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  existingDeckRow = undefined;
  insertedRow = undefined;
  updatedFields = undefined;
  mockGetUserEmail.mockReturnValue("owner@example.com");
  mockGetOrgId.mockReturnValue(null);
});

describe("create-deck — aspectRatio", () => {
  it("omits aspectRatio from the data JSON when not provided (legacy default)", async () => {
    await action.run({ title: "T", slides: [] });
    expect(insertedRow).toBeDefined();
    const data = JSON.parse(insertedRow!.data as string);
    expect("aspectRatio" in data).toBe(false);
  });

  it("includes aspectRatio in the data JSON when provided on a new deck", async () => {
    await action.run({ title: "T", slides: [], aspectRatio: "9:16" });
    const data = JSON.parse(insertedRow!.data as string);
    expect(data.aspectRatio).toBe("9:16");
  });

  it("returns a workspace-scoped deck URL when the app is mounted under a base path", async () => {
    vi.stubEnv("WORKSPACE_GATEWAY_URL", "https://workspace.example.test");
    vi.stubEnv("APP_BASE_PATH", "/slides");

    const result = await action.run({ title: "T", slides: [] });

    expect(result.url).toMatch(
      /^https:\/\/workspace\.example\.test\/slides\/deck\/deck-/,
    );
  });

  it("preserves the existing aspectRatio when bulk-replacing slides without specifying it", async () => {
    existingDeckRow = {
      id: "deck-1",
      data: JSON.stringify({ title: "T", slides: [], aspectRatio: "1:1" }),
    };
    await action.run({
      title: "T2",
      slides: [{ id: "s1", content: "<div></div>" }],
      deckId: "deck-1",
    });
    expect(updatedFields).toBeDefined();
    const data = JSON.parse(updatedFields!.data as string);
    expect(data.aspectRatio).toBe("1:1");
  });

  it("overwrites the existing aspectRatio when one is provided on bulk replace", async () => {
    existingDeckRow = {
      id: "deck-1",
      data: JSON.stringify({ title: "T", slides: [], aspectRatio: "16:9" }),
    };
    await action.run({
      title: "T",
      slides: [],
      deckId: "deck-1",
      aspectRatio: "4:5",
    });
    const data = JSON.parse(updatedFields!.data as string);
    expect(data.aspectRatio).toBe("4:5");
  });

  it("rejects an unknown aspect ratio at the schema boundary", async () => {
    await expect(
      action.run({
        title: "T",
        slides: [],
        aspectRatio: "21:9" as never,
      }),
    ).rejects.toThrow();
    expect(insertedRow).toBeUndefined();
  });
});
