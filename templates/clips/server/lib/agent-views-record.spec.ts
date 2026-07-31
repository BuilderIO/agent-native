import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetDb = vi.hoisted(() => vi.fn());
const mockUserAgent = vi.hoisted(() => ({ value: "" }));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getRequestHeader: () => mockUserAgent.value,
  getRequestIP: () => "203.0.113.7",
}));

vi.mock("./recordings.js", () => ({
  nanoid: () => "view-1",
}));

vi.mock("../db/index.js", () => ({
  getDb: (...args: unknown[]) => mockGetDb(...args),
  schema: {
    recordingAgentViews: {
      recordingId: "recordingId",
      agentKey: "agentKey",
      viewSessionId: "viewSessionId",
      requestCount: "requestCount",
    },
  },
}));

vi.mock("drizzle-orm", () => ({
  count: vi.fn(),
  desc: vi.fn(),
  eq: vi.fn(),
  sql: Object.assign(vi.fn(), { raw: vi.fn() }),
}));

import { recordAgentView } from "./agent-views.js";

function captureInsert() {
  const inserted: Record<string, unknown>[] = [];
  mockGetDb.mockReturnValue({
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        inserted.push(row);
        return { onConflictDoUpdate: async () => undefined };
      },
    }),
  });
  return inserted;
}

describe("recordAgentView", () => {
  beforeEach(() => {
    mockGetDb.mockReset();
    mockUserAgent.value = "";
  });

  it("prefers the label the agent link was minted with over the user-agent", async () => {
    const inserted = captureInsert();
    mockUserAgent.value = "Claude-User/1.0";

    await recordAgentView({} as never, "rec-1", { agentLabel: "Fusion" });

    expect(inserted[0].agentLabel).toBe("Fusion");
  });

  it("falls back to the user-agent label when the link carried no name", async () => {
    const inserted = captureInsert();
    mockUserAgent.value = "Claude-User/1.0";

    await recordAgentView({} as never, "rec-1");

    expect(inserted[0].agentLabel).toBe("Claude");
  });

  it("stores a null label and the raw user-agent for an agent it cannot name", async () => {
    const inserted = captureInsert();
    mockUserAgent.value = "python-requests/2.32";

    await recordAgentView({} as never, "rec-1");

    expect(inserted[0].agentLabel).toBeNull();
    expect(inserted[0].userAgent).toBe("python-requests/2.32");
  });
});
