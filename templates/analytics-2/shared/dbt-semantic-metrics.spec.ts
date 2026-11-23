import { expect, it } from "vitest";

import { sharedQueryableGranularities } from "./dbt-semantic-metrics.js";

it("keeps only the time grains every selected metric can query, in the first metric's order", () => {
  expect(
    sharedQueryableGranularities([
      { queryableGranularities: ["DAY", "WEEK", "MONTH", "YEAR"] },
      { queryableGranularities: ["MONTH", "DAY", "QUARTER"] },
    ]),
  ).toEqual(["DAY", "MONTH"]);
});

it("drops a grain that any one selected metric cannot query", () => {
  expect(
    sharedQueryableGranularities([
      { queryableGranularities: ["DAY", "WEEK"] },
      { queryableGranularities: ["DAY", "WEEK"] },
      { queryableGranularities: ["DAY"] },
    ]),
  ).toEqual(["DAY"]);
});

it("offers no time grains until at least one metric is selected", () => {
  expect(sharedQueryableGranularities([])).toEqual([]);
});

it("lists a shared grain once even when a metric repeats it", () => {
  expect(
    sharedQueryableGranularities([
      { queryableGranularities: ["DAY", "DAY", "HOUR"] },
      { queryableGranularities: ["HOUR", "DAY"] },
    ]),
  ).toEqual(["DAY", "HOUR"]);
});
