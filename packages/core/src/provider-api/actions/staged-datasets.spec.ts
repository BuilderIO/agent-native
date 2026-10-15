import { describe, expect, it, vi } from "vitest";

import { createStagedDatasetActions } from "./staged-datasets.js";

function createRuntime() {
  return {
    getMeta: vi.fn(async () => ({ id: "ds-1", name: "records", rowCount: 2 })),
    getRows: vi.fn(async () => [{ value: 1 }, { value: 2 }]),
    list: vi.fn(async () => [
      {
        id: "ds-1",
        name: "records",
        rowCount: 2,
        columns: ["value"],
        byteSize: 20,
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]),
    delete: vi.fn(async () => true),
    aggregate: vi.fn(() => [{ total: 3 }]),
  };
}

describe("staged dataset action factories", () => {
  it("binds app and owner scope across query, list, and delete", async () => {
    const runtime = createRuntime();
    const actions = createStagedDatasetActions({
      appId: "analytics",
      getOwnerEmail: () => "ada@example.com",
      runtime,
    });

    await expect(actions.query.run({ datasetId: "ds-1" })).resolves.toEqual({
      dataset: { id: "ds-1", name: "records", totalRows: 2 },
      rowCount: 1,
      rows: [{ total: 3 }],
    });
    await expect(actions.list.run({})).resolves.toMatchObject({ total: 1 });
    await expect(actions.delete.run({ datasetId: "ds-1" })).resolves.toEqual({
      deleted: true,
      datasetId: "ds-1",
    });

    const scope = { appId: "analytics", ownerEmail: "ada@example.com" };
    expect(runtime.getMeta).toHaveBeenCalledWith({ id: "ds-1", ...scope });
    expect(runtime.getRows).toHaveBeenCalledWith({ id: "ds-1", ...scope });
    expect(runtime.list).toHaveBeenCalledWith(scope);
    expect(runtime.delete).toHaveBeenCalledWith({ id: "ds-1", ...scope });
  });

  it("preserves the unbound core action contract with appId input", async () => {
    const runtime = createRuntime();
    const actions = createStagedDatasetActions({
      getOwnerEmail: () => "ada@example.com",
      runtime,
    });
    await actions.query.run({ datasetId: "ds-1", appId: "headless" });
    await actions.list.run({ appId: "headless" });
    await actions.delete.run({ datasetId: "ds-1", appId: "headless" });
    expect(runtime.getMeta).toHaveBeenCalledWith({
      id: "ds-1",
      appId: "headless",
      ownerEmail: "ada@example.com",
    });
  });

  describe("query consistency", () => {
    const meta = (updatedAt: number) => ({
      id: "ds-1",
      name: "records",
      rowCount: 2,
      updatedAt,
    });
    const query = (runtime: ReturnType<typeof createRuntime>) =>
      createStagedDatasetActions({
        appId: "analytics",
        getOwnerEmail: () => "ada@example.com",
        runtime,
      }).query.run({ datasetId: "ds-1" });

    it("answers when the dataset is unchanged after the rows are read", async () => {
      const runtime = createRuntime();
      runtime.getMeta.mockResolvedValue(meta(100));

      await expect(query(runtime)).resolves.toMatchObject({ rowCount: 1 });
      expect(runtime.getMeta).toHaveBeenCalledTimes(2);
    });

    it("reports an eviction between the metadata and row reads instead of an empty result", async () => {
      const runtime = createRuntime();
      runtime.getMeta
        .mockResolvedValueOnce(meta(100))
        .mockResolvedValueOnce(null as never);
      runtime.getRows.mockResolvedValue([]);

      await expect(query(runtime)).rejects.toThrow(
        /evicted or replaced while it was being read/,
      );
      expect(runtime.aggregate).not.toHaveBeenCalled();
    });

    it("treats a different row count at the same timestamp as a replacement", async () => {
      const runtime = createRuntime();
      runtime.getMeta
        .mockResolvedValueOnce(meta(100))
        .mockResolvedValueOnce({ ...meta(100), rowCount: 9 });

      await expect(query(runtime)).rejects.toThrow(
        /evicted or replaced while it was being read/,
      );
      expect(runtime.aggregate).not.toHaveBeenCalled();
    });

    it("reports a re-stage between the reads instead of mixing versions", async () => {
      const runtime = createRuntime();
      runtime.getMeta
        .mockResolvedValueOnce(meta(100))
        .mockResolvedValueOnce(meta(200));

      await expect(query(runtime)).rejects.toThrow(
        /evicted or replaced while it was being read/,
      );
      expect(runtime.aggregate).not.toHaveBeenCalled();
    });
  });
});
