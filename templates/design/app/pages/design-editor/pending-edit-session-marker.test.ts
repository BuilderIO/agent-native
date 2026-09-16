// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearPendingEditSessionMarker,
  readPendingEditSessionMarker,
  writePendingEditSessionMarker,
} from "./pending-edit-session-marker";

describe("pending visual edit session marker", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("round-trips one design's pending count without exposing edit content", () => {
    expect(writePendingEditSessionMarker("design/1", 3)).toEqual({
      status: "stored",
    });
    expect(readPendingEditSessionMarker("design/1")).toMatchObject({
      status: "present",
      marker: { count: 3 },
    });
    expect(
      window.localStorage.getItem(
        "agent-native:visual-edit-pending:design%2F1",
      ),
    ).not.toContain("html");
    expect(clearPendingEditSessionMarker("design/1")).toEqual({
      status: "cleared",
    });
    expect(readPendingEditSessionMarker("design/1")).toEqual({
      status: "absent",
    });
  });

  it("distinguishes an unreadable marker from no marker", () => {
    window.localStorage.setItem(
      "agent-native:visual-edit-pending:design-2",
      "not-json",
    );
    expect(readPendingEditSessionMarker("design-2")).toEqual({
      status: "unavailable",
      reason: "browser storage could not be read",
    });
  });
});
