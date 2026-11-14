import { describe, expect, it } from "vitest";

import { getLatestFinishedRun } from "./index.js";
import * as store from "./store.js";

describe("@agent-native/core/data-programs", () => {
  it("exports the finished-run read that apps' own get-data-program actions use", () => {
    expect(getLatestFinishedRun).toBe(store.getLatestFinishedRun);
  });
});
