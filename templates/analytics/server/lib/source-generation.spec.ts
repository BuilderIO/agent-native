import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getBigQueryTableMetadata = vi.fn();

vi.mock("./bigquery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./bigquery")>()),
  getBigQueryTableMetadata,
}));

vi.mock("./credentials-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./credentials-context")>()),
  credentialCacheScope: () => "scope-a",
  requireRequestCredentialContext: () => ({ userEmail: "a@example.com" }),
}));

const { BigQueryMetadataError } = await import("./bigquery");
const {
  SOURCE_GENERATION_REUSE_MS,
  SOURCE_GENERATION_STALE_AFTER_MS,
  resetSourceGenerationLookupsForTests,
  resolveSourceGeneration,
} = await import("./source-generation");

const MODEL = "example-project.dbt_mart.fact_events";
const USERS = "example-project.dbt_mart.dim_users";

describe("resolveSourceGeneration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-16T12:00:00Z"));
    resetSourceGenerationLookupsForTests();
    getBigQueryTableMetadata.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns each table's modified time and a sorted generation vector", async () => {
    getBigQueryTableMetadata.mockImplementation(async (ref) => ({
      lastModifiedTime: String(
        Date.parse(
          ref.tableId === "fact_events"
            ? "2026-10-16T11:20:00Z"
            : "2026-10-16T09:00:00Z",
        ),
      ),
    }));

    const result = await resolveSourceGeneration([MODEL, USERS]);

    expect(result).toMatchObject({
      status: "ok",
      generation: `${USERS}@${Date.parse("2026-10-16T09:00:00Z")},${MODEL}@${Date.parse("2026-10-16T11:20:00Z")}`,
      oldestModifiedAt: "2026-10-16T09:00:00.000Z",
      ageMs: 3 * 60 * 60_000,
      stale: true,
    });
    expect(result.sources.map((source) => source.tableId)).toEqual([
      USERS,
      MODEL,
    ]);
    expect(getBigQueryTableMetadata).toHaveBeenCalledWith(
      { projectId: "example-project", datasetId: "dbt_mart", tableId: "dim_users" },
      undefined,
      { fresh: true },
    );
  });

  it("marks a table modified within the threshold as not stale", async () => {
    getBigQueryTableMetadata.mockResolvedValue({
      lastModifiedTime: String(
        Date.now() - SOURCE_GENERATION_STALE_AFTER_MS + 60_000,
      ),
    });

    await expect(resolveSourceGeneration([MODEL])).resolves.toMatchObject({
      status: "ok",
      stale: false,
    });
  });

  it("reuses a lookup for one minute unless forced", async () => {
    getBigQueryTableMetadata.mockResolvedValue({
      lastModifiedTime: String(Date.now()),
    });

    await resolveSourceGeneration([MODEL]);
    await resolveSourceGeneration([MODEL]);
    expect(getBigQueryTableMetadata).toHaveBeenCalledTimes(1);

    await resolveSourceGeneration([MODEL], { force: true });
    expect(getBigQueryTableMetadata).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(SOURCE_GENERATION_REUSE_MS);
    await resolveSourceGeneration([MODEL]);
    expect(getBigQueryTableMetadata).toHaveBeenCalledTimes(3);
  });

  it("shares one lookup between concurrent callers", async () => {
    let finish: (value: unknown) => void = () => {};
    getBigQueryTableMetadata.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );

    const first = resolveSourceGeneration([MODEL]);
    const second = resolveSourceGeneration([MODEL]);
    finish({ lastModifiedTime: String(Date.now()) });

    await expect(first).resolves.toMatchObject({ status: "ok" });
    await expect(second).resolves.toMatchObject({ status: "ok" });
    expect(getBigQueryTableMetadata).toHaveBeenCalledTimes(1);
  });

  it("reports a failed lookup as unavailable with its reason, never as ok", async () => {
    getBigQueryTableMetadata.mockResolvedValueOnce({
      lastModifiedTime: String(Date.now()),
    });
    await resolveSourceGeneration([MODEL]);

    vi.advanceTimersByTime(SOURCE_GENERATION_REUSE_MS);
    getBigQueryTableMetadata.mockRejectedValueOnce(
      new BigQueryMetadataError(403, "Access Denied"),
    );

    await expect(resolveSourceGeneration([MODEL])).resolves.toEqual({
      status: "unavailable",
      reason: "access_denied",
      checkedAt: "2026-10-16T12:01:00.000Z",
      sources: [
        {
          tableId: MODEL,
          status: "unavailable",
          reason: "access_denied",
          checkedAt: "2026-10-16T12:01:00.000Z",
        },
      ],
    });
  });

  it("keeps the available tables in the vector when one is missing", async () => {
    getBigQueryTableMetadata.mockImplementation(async (ref) => {
      if (ref.tableId === "dim_users") {
        throw new BigQueryMetadataError(404, "Not found");
      }
      return { lastModifiedTime: String(Date.now()) };
    });

    const result = await resolveSourceGeneration([MODEL, USERS]);

    expect(result.status).toBe("unavailable");
    expect(result.status === "unavailable" && result.reason).toBe("not_found");
    expect(result.sources.map((source) => source.status)).toEqual([
      "unavailable",
      "ok",
    ]);
  });

  it("treats a missing modified time and a malformed table id as unavailable", async () => {
    getBigQueryTableMetadata.mockResolvedValue({});

    await expect(resolveSourceGeneration([MODEL])).resolves.toMatchObject({
      status: "unavailable",
      reason: "no_modified_time",
    });
    await expect(
      resolveSourceGeneration(["dbt_mart.fact_events"]),
    ).resolves.toMatchObject({
      status: "unavailable",
      reason: "invalid_table_id",
    });
  });
});
