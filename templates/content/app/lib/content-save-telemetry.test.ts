import { describe, expect, it } from "vitest";

import {
  contentSaveTelemetryHeaders,
  withContentSaveOrigin,
} from "./content-save-telemetry";

describe("Content save request telemetry", () => {
  it("tags recovery without changing the payload or its serialized identity", () => {
    const payload = {
      id: "page",
      browserSaveAttemptId: "attempt",
      content: "Draft",
    };
    const before = JSON.stringify(payload);
    expect(withContentSaveOrigin(payload, "recovery")).toBe(payload);
    expect(contentSaveTelemetryHeaders(payload)).toEqual({
      "X-Content-Save-Origin": "recovery",
    });
    expect(JSON.stringify(payload)).toBe(before);
    expect(Object.getOwnPropertySymbols(payload)).toEqual([]);
    expect(contentSaveTelemetryHeaders({ ...payload })).toBeUndefined();
  });

  it("tags page-load recovery without labeling ordinary saves", () => {
    expect(contentSaveTelemetryHeaders({}, "recovery")).toEqual({
      "X-Content-Save-Origin": "recovery",
    });
    expect(contentSaveTelemetryHeaders({})).toBeUndefined();
  });
});
