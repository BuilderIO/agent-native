// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearPendingEditSessionMarker,
  readPendingEditSessionMarker,
  writePendingEditSessionMarker,
} from "./pending-edit-session-marker";

const storage = new Map<string, string>();
const localStorageMock: Storage = {
  get length() {
    return storage.size;
  },
  clear() {
    storage.clear();
  },
  getItem(key) {
    return storage.get(key) ?? null;
  },
  key(index) {
    return Array.from(storage.keys())[index] ?? null;
  },
  removeItem(key) {
    storage.delete(key);
  },
  setItem(key, value) {
    storage.set(key, value);
  },
};

describe("pending visual edit session marker", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: localStorageMock,
    });
    localStorageMock.clear();
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

  it("keeps a session-ended marker across reload reads until explicit clear", () => {
    expect(writePendingEditSessionMarker("design-reload", 2)).toEqual({
      status: "stored",
    });
    expect(readPendingEditSessionMarker("design-reload")).toMatchObject({
      status: "present",
    });
    expect(readPendingEditSessionMarker("design-reload")).toMatchObject({
      status: "present",
    });
    expect(clearPendingEditSessionMarker("design-reload")).toEqual({
      status: "cleared",
    });
    expect(readPendingEditSessionMarker("design-reload")).toEqual({
      status: "absent",
    });
  });
});
