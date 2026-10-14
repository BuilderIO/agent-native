import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  PRODUCTION_PATH_CANDIDATE_REVISION,
  PRODUCTION_PATH_FIXTURE_REVISION,
  PRODUCTION_PATH_HARNESS_REVISION,
  SYNTHETIC_PRODUCTION_PATH_CASE_IDS,
  validateProductionPathComparisonCsv,
} from "./comparison-validation";

const V10_COMPARISON_CSV = fileURLToPath(
  new URL(
    "./SYNTHETIC-analytics-production-path-v10-before-after.csv",
    import.meta.url,
  ),
);
const V11_COMPARISON_CSV = fileURLToPath(
  new URL(
    "./SYNTHETIC-analytics-production-path-v11-before-after.csv",
    import.meta.url,
  ),
);
const V12_COMPARISON_CSV = fileURLToPath(
  new URL(
    "./SYNTHETIC-analytics-production-path-v12-before-after.csv",
    import.meta.url,
  ),
);
const V13_COMPARISON_CSV = fileURLToPath(
  new URL(
    "./SYNTHETIC-analytics-production-path-v13-before-after.csv",
    import.meta.url,
  ),
);
const V14_COMPARISON_CSV = fileURLToPath(
  new URL(
    "./SYNTHETIC-analytics-production-path-v14-before-after.csv",
    import.meta.url,
  ),
);
const V15_COMPARISON_CSV = fileURLToPath(
  new URL(
    "./SYNTHETIC-analytics-production-path-v15-before-after.csv",
    import.meta.url,
  ),
);
const V16_COMPARISON_CSV = fileURLToPath(
  new URL(
    "./SYNTHETIC-analytics-production-path-v16-before-after.csv",
    import.meta.url,
  ),
);
const V17_COMPARISON_CSV = fileURLToPath(
  new URL(
    "./SYNTHETIC-analytics-production-path-v17-before-after.csv",
    import.meta.url,
  ),
);
const V18_COMPARISON_CSV = fileURLToPath(
  new URL(
    "./SYNTHETIC-analytics-production-path-v18-before-after.csv",
    import.meta.url,
  ),
);
const V19_COMPARISON_CSV = fileURLToPath(
  new URL(
    "./SYNTHETIC-analytics-production-path-v19-before-after.csv",
    import.meta.url,
  ),
);
const V20_COMPARISON_CSV = fileURLToPath(
  new URL(
    "./SYNTHETIC-analytics-production-path-v20-before-after.csv",
    import.meta.url,
  ),
);
const V21_COMPARISON_CSV = fileURLToPath(
  new URL(
    "./SYNTHETIC-analytics-production-path-v21-before-after.csv",
    import.meta.url,
  ),
);
function loadMeasuredComparisonCsv(): string {
  return readFileSync(V21_COMPARISON_CSV, "utf8");
}

describe("Analytics synthetic production-path comparison artifact", () => {
  it("validates the measured v21 production-path comparison", () => {
    const result = validateProductionPathComparisonCsv(
      loadMeasuredComparisonCsv(),
    );

    expect(result).toMatchObject({
      cases: 24,
      before: {
        rows: 48,
        top1: 44,
        retrievalTop1: 44,
        hitAt5: 46,
        failedRuns: 4,
        abortedRuns: 0,
        staleIndexMarked: 4,
        revision: "8961aeb5a901eb8be8e821c10b957fa9203796c7",
        codeRevision:
          "sha256:75bd47c16935eabe816f1f00ec52ddf45b537eb303674dae577e86ee886c3030",
        harnessRevision: PRODUCTION_PATH_HARNESS_REVISION,
      },
      after: {
        rows: 48,
        top1: 48,
        retrievalTop1: 48,
        hitAt5: 48,
        failedRuns: 0,
        abortedRuns: 0,
        staleIndexMarked: 4,
        revision: "a92e2383750d13563ee12331ec9708e6b93cd1e9",
        codeRevision:
          "sha256:6a91fd523eb3630b8f10e4338b3204d29595fcde9557a42bba1df49e7837b299",
        harnessRevision: PRODUCTION_PATH_HARNESS_REVISION,
      },
    });
    expect(result.before.revision).not.toBe(result.after.revision);
    expect(result.before.codeRevision).not.toBe(result.after.codeRevision);
  });

  it("still validates the preserved v20 comparison", () => {
    const result = validateProductionPathComparisonCsv(
      readFileSync(V20_COMPARISON_CSV, "utf8"),
    );

    expect(result).toMatchObject({
      cases: 24,
      before: {
        rows: 48,
        top1: 44,
        hitAt5: 46,
        revision: "217b06fdb294e8efc5ac9f0dd9f079c65307c406",
      },
      after: {
        rows: 48,
        top1: 48,
        hitAt5: 48,
        revision: "980792e5c277be349cf0198fa87d26bc41b7daac",
      },
    });
  });

  it("still validates the preserved v19 comparison", () => {
    const result = validateProductionPathComparisonCsv(
      readFileSync(V19_COMPARISON_CSV, "utf8"),
    );

    expect(result).toMatchObject({
      cases: 24,
      before: {
        rows: 48,
        top1: 44,
        hitAt5: 46,
        revision: "4715962a57720a2ff5881cb8eea39c1535518cf8",
      },
      after: {
        rows: 48,
        top1: 48,
        hitAt5: 48,
        revision: "051ebf123c26257be2058efbfb13468c9226d37a",
      },
    });
  });

  it("still validates the preserved v18 comparison", () => {
    const result = validateProductionPathComparisonCsv(
      readFileSync(V18_COMPARISON_CSV, "utf8"),
    );

    expect(result).toMatchObject({
      cases: 24,
      before: {
        rows: 48,
        top1: 44,
        hitAt5: 46,
        revision: "4715962a57720a2ff5881cb8eea39c1535518cf8",
      },
      after: {
        rows: 48,
        top1: 48,
        hitAt5: 48,
        revision: "1e9eb1188e5250d594d43c0a37b0eef7f177fe60",
      },
    });
  });

  it("still validates the preserved v17 comparison", () => {
    const result = validateProductionPathComparisonCsv(
      readFileSync(V17_COMPARISON_CSV, "utf8"),
    );

    expect(result).toMatchObject({
      cases: 24,
      before: {
        rows: 48,
        top1: 44,
        hitAt5: 46,
        revision: "fadfb1b593c71e6a03282269dcb0c9df946188d1",
      },
      after: {
        rows: 48,
        top1: 48,
        hitAt5: 48,
        revision: "5a53b3d1bef1fccbfb4ea49da16babd9cb45413c",
      },
    });
  });

  it("rejects a missing phase/run row", () => {
    const csv = loadMeasuredComparisonCsv();
    const rows = csv.trimEnd().split(/\r?\n/);

    expect(() =>
      validateProductionPathComparisonCsv(rows.slice(0, -1).join("\n")),
    ).toThrow("two runs per case and phase");
  });

  it("rejects a zero-based candidate rank", () => {
    const rows = loadMeasuredComparisonCsv().trimEnd().split(/\r?\n/);
    const columns = rows[1]!.split(",");
    columns[7] = "0";
    columns[8] = "ranked_below_1";
    columns[9] = "0";
    columns[10] = "true";
    rows[1] = columns.join(",");

    expect(() => validateProductionPathComparisonCsv(rows.join("\n"))).toThrow(
      "invalid expected rank",
    );
  });

  it("rejects a top-1 result without a completed production-path action", () => {
    const rows = loadMeasuredComparisonCsv().trimEnd().split(/\r?\n/);
    const columns = rows[1]!.split(",");
    columns[11] = "0";
    rows[1] = columns.join(",");

    expect(() => validateProductionPathComparisonCsv(rows.join("\n"))).toThrow(
      "invalid successful production-path score",
    );
  });

  it.each(["production_path_failed", "unexpected_action"] as const)(
    "rejects a %s row that claims a retrieval rank",
    (reasonCode) => {
      const rows = loadMeasuredComparisonCsv().trimEnd().split(/\r?\n/);
      const columns = rows[1]!.split(",");
      columns[7] = "0";
      columns[8] = reasonCode;
      columns[9] = "1";
      columns[10] = "true";
      if (reasonCode === "unexpected_action") {
        columns[11] = "0";
        columns[12] = "1";
      }
      rows[1] = columns.join(",");

      expect(() =>
        validateProductionPathComparisonCsv(rows.join("\n")),
      ).toThrow("failure reasons cannot report a retrieval rank or hit");
    },
  );

  it("rejects failure codes that contradict their observed action fields", () => {
    const rows = loadMeasuredComparisonCsv().trimEnd().split(/\r?\n/);
    const columns = rows[1]!.split(",");
    columns[7] = "0";
    columns[8] = "unexpected_action";
    columns[9] = "";
    columns[10] = "false";
    columns[12] = "0";
    rows[1] = columns.join(",");

    expect(() => validateProductionPathComparisonCsv(rows.join("\n"))).toThrow(
      "unexpected_action reason does not match its action fields",
    );
  });

  it("rejects failed action counts above the recorded action total", () => {
    const rows = loadMeasuredComparisonCsv().trimEnd().split(/\r?\n/);
    const columns = rows[1]!.split(",");
    columns[7] = "0";
    columns[8] = "action_failed";
    columns[9] = "";
    columns[10] = "false";
    columns[13] = "2";
    rows[1] = columns.join(",");

    expect(() => validateProductionPathComparisonCsv(rows.join("\n"))).toThrow(
      "failed action calls exceed recorded action calls",
    );
  });

  it("rejects an after phase that is not pinned to the candidate revision", () => {
    const stale = loadMeasuredComparisonCsv().replaceAll(
      PRODUCTION_PATH_CANDIDATE_REVISION,
      "b".repeat(40),
    );

    expect(() => validateProductionPathComparisonCsv(stale)).toThrow(
      "pinned baseline and candidate phases",
    );
  });

  it("rejects well-formed code hashes unrelated to the pinned source revisions", () => {
    const rows = loadMeasuredComparisonCsv().trimEnd().split(/\r?\n/);
    for (let index = 1; index < rows.length; index++) {
      if (!rows[index]!.includes(",after,")) continue;
      const columns = rows[index]!.split(",");
      columns[3] = "sha256:" + "f".repeat(64);
      rows[index] = columns.join(",");
    }

    expect(() => validateProductionPathComparisonCsv(rows.join("\n"))).toThrow(
      "code hashes do not match the pinned source revisions",
    );
  });

  it("rejects integers outside the safe numeric range", () => {
    const rows = loadMeasuredComparisonCsv().trimEnd().split(/\r?\n/);
    const columns = rows[1]!.split(",");
    columns[19] = "9007199254740992";
    rows[1] = columns.join(",");

    expect(() => validateProductionPathComparisonCsv(rows.join("\n"))).toThrow(
      "invalid latency_ms",
    );
  });

  it("rejects a duplicate that misaligns the before/after case/run pairs", () => {
    const rows = loadMeasuredComparisonCsv().trimEnd().split(/\r?\n/);
    const lastRow = rows.at(-1)!;
    const columns = lastRow.split(",");
    columns[0] = SYNTHETIC_PRODUCTION_PATH_CASE_IDS[7];
    rows[rows.length - 1] = columns.join(",");

    expect(() => validateProductionPathComparisonCsv(rows.join("\n"))).toThrow(
      "duplicate case/run pair",
    );
  });

  it("rejects a mismatched before/after fixture", () => {
    const changed = loadMeasuredComparisonCsv().replaceAll(
      PRODUCTION_PATH_FIXTURE_REVISION,
      "synthetic-analytics-retrieval-v99",
    );

    expect(() => validateProductionPathComparisonCsv(changed)).toThrow(
      "fixture revision is not pinned",
    );
  });

  it("pins stale-index markers to the measured cases and phases", () => {
    const rows = loadMeasuredComparisonCsv().trimEnd().split(/\r?\n/);
    const header = rows[0]!.split(",");
    const markerIndex = header.indexOf("stale_index_marked");
    const unrelatedRowIndex = rows.findIndex((line) =>
      line.startsWith("current-organization-role-roster,before,"),
    );
    const unrelatedColumns = rows[unrelatedRowIndex]!.split(",");
    unrelatedColumns[markerIndex] = "true";
    rows[unrelatedRowIndex] = unrelatedColumns.join(",");

    expect(() => validateProductionPathComparisonCsv(rows.join("\n"))).toThrow(
      "stale-index markers must match the pinned candidate case",
    );

    const validRows = loadMeasuredComparisonCsv().trimEnd().split(/\r?\n/);
    const beforeRowIndex = validRows.findIndex((line) =>
      line.startsWith("stale-generated-index-yields-to-current-source,before,"),
    );
    const beforeColumns = validRows[beforeRowIndex]!.split(",");
    beforeColumns[markerIndex] = "false";
    validRows[beforeRowIndex] = beforeColumns.join(",");

    expect(() =>
      validateProductionPathComparisonCsv(validRows.join("\n")),
    ).toThrow("stale-index markers must match the pinned cases and phases");
  });

  it("rejects before/after rows made with different harness bytes", () => {
    const rows = loadMeasuredComparisonCsv().trimEnd().split(/\r?\n/);
    for (let index = 1; index < rows.length; index++) {
      if (!rows[index]!.includes(",after,")) continue;
      const columns = rows[index]!.split(",");
      columns[4] = "sha256:" + "d".repeat(64);
      rows[index] = columns.join(",");
    }

    expect(() => validateProductionPathComparisonCsv(rows.join("\n"))).toThrow(
      "identical harness bytes",
    );
  });

  it("retains aborted production-path runs as failures in the comparison", () => {
    const rows = loadMeasuredComparisonCsv().trimEnd().split(/\r?\n/);
    const afterStart = 1 + SYNTHETIC_PRODUCTION_PATH_CASE_IDS.length * 2;
    const columns = rows[afterStart]!.split(",");
    columns[7] = "0";
    columns[8] = "production_path_failed";
    columns[9] = "";
    columns[10] = "false";
    columns[11] = "0";
    columns[12] = "0";
    columns[13] = "0";
    columns[14] = "false";
    columns[15] = "true";
    columns[16] = "0";
    columns[17] = "0";
    columns[18] = "0";
    columns[19] = "0";
    rows[afterStart] = columns.join(",");

    const result = validateProductionPathComparisonCsv(rows.join("\n"));
    expect(result.after).toMatchObject({
      rows: 48,
      top1: 47,
      retrievalTop1: 47,
      hitAt5: 47,
      failedRuns: 1,
      abortedRuns: 1,
    });
  });

  it("rejects a phase where most production-path runs fail", () => {
    const rows = loadMeasuredComparisonCsv().trimEnd().split(/\r?\n/);
    const afterStart = 1 + SYNTHETIC_PRODUCTION_PATH_CASE_IDS.length * 2;
    const staleCases = new Set([
      "stale-generated-index-yields-to-current-source",
      "approved-stale-generated-entry-yields-to-current-roster",
    ]);
    for (let index = afterStart; index < rows.length; index += 1) {
      const columns = rows[index]!.split(",");
      if (staleCases.has(columns[0]!)) continue;
      columns[7] = "0";
      columns[8] = "production_path_failed";
      columns[9] = "";
      columns[10] = "false";
      columns[11] = "0";
      columns[12] = "0";
      columns[13] = "0";
      columns[14] = "false";
      columns[15] = "true";
      columns[16] = "0";
      columns[17] = "0";
      columns[18] = "0";
      columns[19] = "0";
      columns[20] = "false";
      rows[index] = columns.join(",");
    }

    expect(() => validateProductionPathComparisonCsv(rows.join("\n"))).toThrow(
      "At least 90% of each phase must complete the production path before comparison.",
    );
  });

  it("does not count production-path failure codes as completed runs", () => {
    const rows = loadMeasuredComparisonCsv().trimEnd().split(/\r?\n/);
    const afterStart = 1 + SYNTHETIC_PRODUCTION_PATH_CASE_IDS.length * 2;
    for (let index = afterStart; index < afterStart + 5; index += 1) {
      const columns = rows[index]!.split(",");
      columns[7] = "0";
      columns[8] = "production_path_failed";
      columns[9] = "";
      columns[10] = "false";
      rows[index] = columns.join(",");
    }

    expect(() => validateProductionPathComparisonCsv(rows.join("\n"))).toThrow(
      "At least 90% of each phase must complete the production path before comparison.",
    );
  });

  it("retains a completed retrieval miss for honest quality reporting", () => {
    const rows = loadMeasuredComparisonCsv().trimEnd().split(/\r?\n/);
    const afterStart = 1 + SYNTHETIC_PRODUCTION_PATH_CASE_IDS.length * 2;
    const columns = rows[afterStart + 2]!.split(",");
    columns[7] = "0";
    columns[8] = "ranked_below_1";
    columns[9] = "6";
    columns[10] = "false";
    rows[afterStart + 2] = columns.join(",");

    const result = validateProductionPathComparisonCsv(rows.join("\n"));
    expect(result.after).toMatchObject({
      top1: 47,
      retrievalTop1: 47,
      hitAt5: 47,
      failedRuns: 1,
      abortedRuns: 0,
    });
  });

  it("validates the preserved v10 measured comparison", async () => {
    const csv = await readFile(V10_COMPARISON_CSV, "utf8");
    const result = validateProductionPathComparisonCsv(csv);

    expect(result).toMatchObject({
      cases: 15,
      before: { rows: 30, top1: 6, hitAt5: 16 },
      after: { rows: 30, top1: 30, hitAt5: 30 },
    });
    expect(result.before.revision).not.toBe(result.after.revision);
    expect(result.before.codeRevision).not.toBe(result.after.codeRevision);
  });

  it("validates the checked-in v11 measured comparison", async () => {
    const csv = await readFile(V11_COMPARISON_CSV, "utf8");
    const result = validateProductionPathComparisonCsv(csv);

    expect(result).toMatchObject({
      cases: 16,
      before: { rows: 32, top1: 6, hitAt5: 18 },
      after: { rows: 32, top1: 32, hitAt5: 32 },
    });
    expect(result.before.revision).not.toBe(result.after.revision);
    expect(result.before.codeRevision).not.toBe(result.after.codeRevision);
  });

  it("validates the v12 measurement and reports its baseline misses", async () => {
    const csv = await readFile(V12_COMPARISON_CSV, "utf8");
    const result = validateProductionPathComparisonCsv(csv);

    expect(result).toMatchObject({
      cases: 20,
      before: {
        rows: 40,
        top1: 6,
        retrievalTop1: 6,
        hitAt5: 18,
        failedRuns: 34,
        abortedRuns: 0,
        revision: "1999aef1ad68dcf9d44423fa95df1a7acb67e8c5",
        codeRevision:
          "sha256:5bf2d8b224e03b2fb8081a0f61e6e626d420a51c2a3de60c6d6d50595063e8f7",
        harnessRevision:
          "sha256:ca70d1a86c17bff2777ac22b4428f4f4370e4d71ad96e60266f22a54a6ba2792",
      },
      after: {
        rows: 40,
        top1: 40,
        retrievalTop1: 40,
        hitAt5: 40,
        failedRuns: 0,
        abortedRuns: 0,
        revision: "35fdffa8f309e2a7820d6c6e1e5decad04ebf989",
        codeRevision:
          "sha256:7b4e074cb1b62a254e00af4924c37ac923ff280dfdf74b63fb000a207d929e38",
        harnessRevision:
          "sha256:ca70d1a86c17bff2777ac22b4428f4f4370e4d71ad96e60266f22a54a6ba2792",
      },
    });
  });

  it("validates the preserved v13 production-path comparison", async () => {
    const csv = await readFile(V13_COMPARISON_CSV, "utf8");
    const result = validateProductionPathComparisonCsv(csv);

    expect(result).toMatchObject({
      cases: 21,
      before: {
        rows: 42,
        top1: 6,
        retrievalTop1: 6,
        hitAt5: 20,
        failedRuns: 36,
        abortedRuns: 0,
        revision: "afe2ee7e45f6f3f380571a6d18918fc49d71c6e1",
        codeRevision:
          "sha256:5efa951a394abdcc5d39090b58d0277f1e0392a0ca1c984c96def8935cabcafe",
        harnessRevision:
          "sha256:91a1a65cebb864d1368b624b9dac7e2ab4c32710357e52c4a9c25c6c705a7d97",
      },
      after: {
        rows: 42,
        top1: 42,
        retrievalTop1: 42,
        hitAt5: 42,
        failedRuns: 0,
        abortedRuns: 0,
        revision: "586b87b50a99fe0d5023637df9c735bafb47d035",
        codeRevision:
          "sha256:f1cda350256c3ec48f87bf151c7284291ecf4467b2c1f9fa5c5062e5fea8b764",
        harnessRevision:
          "sha256:91a1a65cebb864d1368b624b9dac7e2ab4c32710357e52c4a9c25c6c705a7d97",
      },
    });
  });

  it("preserves the historical v14 comparison and stale-index signal", async () => {
    const csv = await readFile(V14_COMPARISON_CSV, "utf8");
    const result = validateProductionPathComparisonCsv(csv);

    expect(result).toMatchObject({
      cases: 22,
      before: {
        rows: 44,
        top1: 8,
        retrievalTop1: 8,
        hitAt5: 22,
        failedRuns: 36,
        abortedRuns: 0,
        staleIndexMarked: 0,
        revision: "0fb4de3ed8bd4e317543575c9b188b93db392d26",
        codeRevision:
          "sha256:16768496b83db90ba30f74df6ea49f934c1ee11e6ba3fb8d1c7f65ee089e44ac",
        harnessRevision:
          "sha256:04428dd484b504b646a93e1b6b35151fcc344568c8c1cd7780fa498822df8a93",
      },
      after: {
        rows: 44,
        top1: 44,
        retrievalTop1: 44,
        hitAt5: 44,
        failedRuns: 0,
        abortedRuns: 0,
        staleIndexMarked: 2,
        revision: "ba53610515501c3f8657168c2c7346a713ac03df",
        codeRevision:
          "sha256:70424c4be93310ac67c21eaf3af6d68e10c18d87e495bce2653c5c40b409e07c",
        harnessRevision:
          "sha256:04428dd484b504b646a93e1b6b35151fcc344568c8c1cd7780fa498822df8a93",
      },
    });
  });

  it("rejects the v15 artifact whose baseline never completed the production path", async () => {
    const csv = await readFile(V15_COMPARISON_CSV, "utf8");
    expect(() => validateProductionPathComparisonCsv(csv)).toThrow(
      "At least 90% of each phase must complete the production path",
    );
  });

  it("validates the checked-in v16 production-path measurement", async () => {
    const csv = await readFile(V16_COMPARISON_CSV, "utf8");
    const result = validateProductionPathComparisonCsv(csv);

    expect(result).toMatchObject({
      cases: 24,
      before: {
        rows: 48,
        top1: 44,
        retrievalTop1: 44,
        hitAt5: 46,
        failedRuns: 4,
        abortedRuns: 0,
        staleIndexMarked: 4,
        revision: "db2f859fae3e5c9bab5ad5d1257d24a5ef152a8f",
        codeRevision:
          "sha256:1f4a8302df8d7a73e6b2a1149052a93c5ebcf93d31beeee4994883c08ab4c7d1",
        harnessRevision:
          "sha256:9bee80ec0ce2bfb05e67cb5be619c8a98b82c3ef8aee3d3945905d1e9820a73a",
      },
      after: {
        rows: 48,
        top1: 48,
        retrievalTop1: 48,
        hitAt5: 48,
        failedRuns: 0,
        abortedRuns: 0,
        staleIndexMarked: 4,
        revision: "7beae453965eb1590ddf80d0991a211aaa3aea7c",
        codeRevision:
          "sha256:96c8192effb85af20b1109a9b525156ce9f5fbaa44d390870660e350f465a1b8",
        harnessRevision:
          "sha256:9bee80ec0ce2bfb05e67cb5be619c8a98b82c3ef8aee3d3945905d1e9820a73a",
      },
    });
    expect(result.before.revision).not.toBe(result.after.revision);
    expect(result.before.codeRevision).not.toBe(result.after.codeRevision);
  });
});
