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

const uploadMock = vi.hoisted(() => ({
  uploadFile: vi.fn(async (input: { data: Buffer }) => ({
    url: "https://cdn.example.com/uploaded-export",
    body: input.data.toString("utf8"),
  })),
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

vi.mock("@agent-native/core/file-upload", () => uploadMock);
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "owner@example.com",
}));

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

  it("uploads the export to file storage instead of writing to local disk", async () => {
    const result = await exportResponses.run({
      form: "form_1",
      format: "csv",
    });

    expect(uploadMock.uploadFile).toHaveBeenCalledOnce();
    const call = uploadMock.uploadFile.mock.calls[0]?.[0];
    expect(call.ownerEmail).toBe("owner@example.com");
    expect(call.filename).toBe("export-form_1.csv");
    expect(result).toContain("https://cdn.example.com/uploaded-export");
  });

  it("scrubs synthetic anonymous submitter emails from CSV exports", async () => {
    await exportResponses.run({ form: "form_1", format: "csv" });

    const csv = String(uploadMock.uploadFile.mock.calls[0]?.[0]?.data ?? "");
    expect(csv).not.toContain("anon-abc123@agent-native.com");
    expect(csv).toContain("real-user@example.com");
  });

  it("scrubs synthetic anonymous submitter emails from JSON exports", async () => {
    await exportResponses.run({ form: "form_1", format: "json" });

    const json = JSON.parse(
      String(uploadMock.uploadFile.mock.calls[0]?.[0]?.data ?? "{}"),
    );
    expect(json[0].submitterEmail).toBeNull();
    expect(json[1].submitterEmail).toBe("real-user@example.com");
  });

  it("throws a clear error when no file storage provider is configured", async () => {
    uploadMock.uploadFile.mockResolvedValueOnce(null as never);

    await expect(
      exportResponses.run({ form: "form_1", format: "csv" }),
    ).rejects.toThrow(/file storage is not configured/);
  });
});
