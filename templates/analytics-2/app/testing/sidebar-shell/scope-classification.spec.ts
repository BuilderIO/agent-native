import { describe, expect, it } from "vitest";

import { classifyFlows } from "../../../e2e/scope-classification";

const scope =
  "## Core (1)\n`setup`\n## Labs (1)\n`secondary`\n## Cut (1)\n`deferred`\n";
describe("scope classification", () => {
  it("keeps core checks and skips classified secondary checks", () => {
    expect([
      ...classifyFlows(scope, ["setup", "secondary", "deferred"]),
    ]).toEqual(["secondary", "deferred"]);
  });
  it("rejects unclassified or conflicting checks and missing sections", () => {
    expect(() => classifyFlows(scope, ["unknown"])).toThrow(/Unclassified/);
    expect(() =>
      classifyFlows(scope.replace("`secondary`", "`setup`"), ["setup"]),
    ).toThrow(/both core and non-core/);
    expect(() => classifyFlows("## Core (1)\n`setup`", ["setup"])).toThrow(
      /Missing Labs/,
    );
  });
});

it("classifies every registered supplemental flow", async () => {
  const { readFile } = await import("node:fs/promises");
  const { supplementalFlowNames } =
    await import("../../../e2e/supplemental-flow-names");
  const scope = await readFile(
    new URL("../../../scope/analytics-2.md", import.meta.url),
    "utf8",
  );
  const nonCore = classifyFlows(scope, supplementalFlowNames);
  expect(nonCore.has("python-cell-run")).toBe(true);
  expect(nonCore.has("chart-formatting")).toBe(false);
});

it("report 1794900494.750729 keeps report-1794900494.750729-popular classified as Core", async () => {
  const { readFile } = await import("node:fs/promises");
  const scope = await readFile(
    new URL("../../../scope/analytics-2.md", import.meta.url),
    "utf8",
  );
  const nonCore = classifyFlows(scope, ["report-1794900494.750729-popular"]);
  expect(nonCore.has("report-1794900494.750729-popular")).toBe(false);
});
