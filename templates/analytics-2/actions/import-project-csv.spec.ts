import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  upsert: vi.fn(),
  requireOwnedProject: vi.fn(),
  readProjectFile: vi.fn(),
}));

vi.mock("@agent-native/core/provider-api/staged-datasets-store", () => ({
  stagedDatasetId: () => "dataset-id",
  upsertStagedDataset: storage.upsert,
}));
vi.mock("../server/lib/project-action-access.js", () => ({
  requireOwnedProject: storage.requireOwnedProject,
}));
vi.mock("../server/model/project-files.js", () => ({
  readProjectFile: storage.readProjectFile,
}));

const { default: action, parseProjectCsv } =
  await import("./import-project-csv");

describe("project CSV staging", () => {
  beforeEach(() => {
    storage.upsert.mockReset();
    storage.requireOwnedProject.mockReset();
    storage.readProjectFile.mockReset();
    storage.requireOwnedProject.mockResolvedValue({
      scope: { ownerEmail: "owner@example.test", orgId: "org-1" },
      project: { id: "project-1" },
    });
    storage.upsert.mockImplementation(async (input) => ({
      id: input.id,
      name: input.name,
      rowCount: input.rows.length,
      columns: input.columns,
      sourceComplete: input.sourceComplete,
    }));
  });

  it("preserves CSV headers and typed values as complete staged rows", async () => {
    const parsed = parseProjectCsv(
      Buffer.from("name,amount,active\nAda,12,true\n"),
    );
    expect(parsed).toEqual({
      columns: ["name", "amount", "active"],
      rows: [{ name: "Ada", amount: "12", active: "true" }],
    });

    const result = await action.run(
      {
        projectId: "project-1",
        filename: "report.csv",
        dataBase64: Buffer.from("name,amount\nAda,12\n").toString("base64"),
      },
      {} as never,
    );

    expect(storage.upsert).toHaveBeenCalledWith({
      id: "dataset-id",
      appId: "analytics-2",
      ownerEmail: "owner@example.test",
      name: "report",
      columns: ["name", "amount"],
      rows: [{ name: "Ada", amount: "12" }],
      sourceComplete: true,
    });
    expect(result.dataset).toMatchObject({
      id: "dataset-id",
      rowCount: 1,
      sourceComplete: true,
    });
  });

  it("stages a CSV attached to the project by file id", async () => {
    storage.readProjectFile.mockResolvedValue({
      file: { filename: "sales.csv" },
      dataBase64: Buffer.from("region,total\nEU,5\n").toString("base64"),
    });

    const result = await action.run(
      {
        projectId: "project-1",
        fileId: "3f1c2a9e-0d4b-4c8e-9a57-1b2c3d4e5f60",
      },
      {} as never,
    );

    expect(storage.readProjectFile).toHaveBeenCalledWith(
      "project-1",
      "3f1c2a9e-0d4b-4c8e-9a57-1b2c3d4e5f60",
    );
    expect(storage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "sales",
        columns: ["region", "total"],
        rows: [{ region: "EU", total: "5" }],
      }),
    );
    expect(result.dataset.rowCount).toBe(1);
  });

  it("rejects empty, duplicate, and missing CSV headers", () => {
    expect(() => parseProjectCsv(Buffer.from(",\nAda,\n"))).toThrow();
    expect(() =>
      parseProjectCsv(Buffer.from("name,name\nAda,Byron\n")),
    ).toThrow();
    expect(() => parseProjectCsv(Buffer.from(""))).toThrow();
    expect(() =>
      parseProjectCsv(Buffer.from("name\nAda,unexpected\n")),
    ).toThrow();
  });

  it("decodes UTF-8 text without a byte-order mark", () => {
    expect(parseProjectCsv(Buffer.from("café,日本\n1,2\n"))).toEqual({
      columns: ["café", "日本"],
      rows: [{ café: "1", 日本: "2" }],
    });
  });

  it("reports an empty file as a missing header and over-wide rows as a width mismatch", () => {
    expect(() => parseProjectCsv(Buffer.from(""))).toThrow(
      "The CSV file has no header row.",
    );
    expect(() => parseProjectCsv(Buffer.from("p\n50%\n$1,000\n"))).toThrow(
      "A CSV row has more values than the header.",
    );
    expect(() => parseProjectCsv(Buffer.from("a,,c\n1,2,3\n"))).toThrow(
      "CSV column names cannot be empty.",
    );
  });

  it("ignores trailing empty header cells", () => {
    expect(parseProjectCsv(Buffer.from("a,b,\n1,2,\n"))).toEqual({
      columns: ["a", "b"],
      rows: [{ a: "1", b: "2" }],
    });
  });

  it("decodes UTF-16LE/BE and UTF-8 BOM exports and avoids HTML or SYLK sniffing", () => {
    const utf16le = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from("name,val\r\nAda,1\r\n", "utf16le"),
    ]);
    expect(parseProjectCsv(utf16le)).toEqual({
      columns: ["name", "val"],
      rows: [{ name: "Ada", val: "1" }],
    });

    const utf16be = Buffer.concat([
      Buffer.from([0xfe, 0xff]),
      Buffer.from("name,val\r\nAda,1\r\n", "utf16le").swap16(),
    ]);
    expect(parseProjectCsv(utf16be)).toEqual({
      columns: ["name", "val"],
      rows: [{ name: "Ada", val: "1" }],
    });

    expect(
      parseProjectCsv(
        Buffer.from('<html>,col2\n"<table><tr><td>x</td></tr></table>",2\n'),
      ),
    ).toEqual({
      columns: ["<html>", "col2"],
      rows: [{ "<html>": "<table><tr><td>x</td></tr></table>", col2: "2" }],
    });

    expect(parseProjectCsv(Buffer.from("<!DOCTYPE html>,val\n1,2\n"))).toEqual({
      columns: ["<!DOCTYPE html>", "val"],
      rows: [{ "<!DOCTYPE html>": "1", val: "2" }],
    });

    expect(parseProjectCsv(Buffer.from("ID;P\n1;Ada\n"))).toEqual({
      columns: ["ID", "P"],
      rows: [{ ID: "1", P: "Ada" }],
    });

    expect(parseProjectCsv(Buffer.from("id\tname\n1\tAda\n"))).toEqual({
      columns: ["id", "name"],
      rows: [{ id: "1", name: "Ada" }],
    });
  });

  it("rejects a file with no name before the extension", async () => {
    await expect(
      action.run(
        {
          projectId: "project-1",
          filename: ".csv",
          dataBase64: Buffer.from("name\nAda\n").toString("base64"),
        },
        {} as never,
      ),
    ).rejects.toThrow("Choose a CSV file.");
  });

  it("requires an editable project and a CSV filename", async () => {
    await expect(
      action.run(
        {
          projectId: "project-1",
          filename: "report.txt",
          dataBase64: Buffer.from("name\nAda\n").toString("base64"),
        },
        {} as never,
      ),
    ).rejects.toThrow("Choose a CSV file.");
    expect(storage.upsert).not.toHaveBeenCalled();
  });
});
