import { beforeEach, describe, expect, it, vi } from "vitest";

const rows = [
  {
    id: "response_1",
    formId: "form_1",
    data: JSON.stringify({ msg: "anonymous" }),
    submittedAt: "2026-06-27T12:00:00.000Z",
    ip: null,
    submitterEmail: "anon-abc123@agent-native.com",
    pageUrl: null,
    clientSurface: null,
  },
  {
    id: "response_2",
    formId: "form_1",
    data: JSON.stringify({ msg: "signed in" }),
    submittedAt: "2026-06-27T12:01:00.000Z",
    ip: null,
    submitterEmail: "real-user@example.com",
    pageUrl: null,
    clientSurface: null,
  },
];

const form = {
  fields: JSON.stringify([
    { id: "msg", type: "textarea", label: "Message", required: false },
  ]),
};

const dbMock = vi.hoisted(() => {
  let results: unknown[][] = [];

  function query() {
    const result = results.shift() ?? [];
    const builder = {
      from: vi.fn(() => builder),
      where: vi.fn(() => builder),
      orderBy: vi.fn(() => builder),
      limit: vi.fn(async () => result),
      then: (resolve: (value: unknown[]) => unknown) => resolve(result),
    };
    return builder;
  }

  return {
    setResults(next: unknown[][]) {
      results = [...next];
    },
    getDb: () => ({
      select: vi.fn(() => query()),
    }),
  };
});

const sharingMock = vi.hoisted(() => ({
  assertAccess: vi.fn(async () => ({ resource: form })),
}));

vi.mock("../server/db/index.js", async () => ({
  getDb: dbMock.getDb,
  schema: await vi.importActual("../server/db/schema.js"),
}));

vi.mock("@agent-native/core/sharing", () => sharingMock);

const { default: listResponses } = await import("./list-responses.js");

describe("list-responses action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.setResults([rows, [{ count: rows.length }]]);
  });

  it("scrubs synthetic anonymous submitter emails from returned rows", async () => {
    const result = await listResponses.run({ formId: "form_1", limit: 10 });

    expect(result.responses[0].submitterEmail).toBeNull();
    expect(result.responses[1].submitterEmail).toBe("real-user@example.com");
    expect(result.total).toBe(rows.length);
  });
});
