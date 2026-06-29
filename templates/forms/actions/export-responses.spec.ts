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

const fsMock = vi.hoisted(() => ({
  writeFileSync: vi.fn(),
}));

const dbMock = vi.hoisted(() => {
  let responses: unknown[] = [];
  return {
    setResponses(next: unknown[]) {
      responses = [...next];
    },
    getDb: () => ({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(async () => responses),
          })),
        })),
      })),
    }),
  };
});

const sharingMock = vi.hoisted(() => ({
  assertAccess: vi.fn(async () => ({ resource: form })),
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    default: {
      ...actual,
      writeFileSync: fsMock.writeFileSync,
    },
    writeFileSync: fsMock.writeFileSync,
  };
});

vi.mock("../server/db/index.js", async () => ({
  getDb: dbMock.getDb,
  schema: await vi.importActual("../server/db/schema.js"),
}));

vi.mock("@agent-native/core/sharing", () => sharingMock);

const { default: exportResponses } = await import("./export-responses.js");

describe("export-responses action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.setResponses(rows);
  });

  it("scrubs synthetic anonymous submitter emails from CSV exports", async () => {
    await exportResponses.run({
      form: "form_1",
      output: "/tmp/forms-export.csv",
      format: "csv",
    });

    const csv = String(fsMock.writeFileSync.mock.calls[0]?.[1] ?? "");
    expect(csv).not.toContain("anon-abc123@agent-native.com");
    expect(csv).toContain("real-user@example.com");
  });

  it("scrubs synthetic anonymous submitter emails from JSON exports", async () => {
    await exportResponses.run({
      form: "form_1",
      output: "/tmp/forms-export.json",
      format: "json",
    });

    const json = JSON.parse(String(fsMock.writeFileSync.mock.calls[0]?.[1]));
    expect(json[0].submitterEmail).toBeNull();
    expect(json[1].submitterEmail).toBe("real-user@example.com");
  });
});
