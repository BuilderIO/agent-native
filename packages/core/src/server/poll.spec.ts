import { describe, it, expect } from "vitest";

// The poll module uses module-level state (_version, _buffer).
// We re-import for each test suite to get fresh state via dynamic import.
// But since module caching means we share state, we test in order.

import { getVersion, recordChange, getChangesSince } from "./poll.js";

describe("poll", () => {
  describe("getVersion", () => {
    it("returns the current version counter", () => {
      expect(typeof getVersion()).toBe("number");
      expect(getVersion()).toBeGreaterThanOrEqual(0);
    });
  });

  describe("recordChange", () => {
    it("strictly increases the version", () => {
      const before = getVersion();
      recordChange({ source: "app-state", type: "change", key: "test" });
      expect(getVersion()).toBeGreaterThan(before);
    });

    it("increases version for each call", () => {
      const before = getVersion();
      recordChange({ source: "settings", type: "change", key: "a" });
      const mid = getVersion();
      recordChange({ source: "settings", type: "delete", key: "b" });
      expect(mid).toBeGreaterThan(before);
      expect(getVersion()).toBeGreaterThan(mid);
    });
  });

  describe("getChangesSince", () => {
    it("returns empty events when since >= version", () => {
      const v = getVersion();
      const result = getChangesSince(v);
      expect(result.version).toBe(v);
      expect(result.events).toEqual([]);
    });

    it("returns empty events when since > version", () => {
      const v = getVersion();
      const result = getChangesSince(v + 100);
      expect(result.version).toBe(v);
      expect(result.events).toEqual([]);
    });

    it("returns events after a given version", () => {
      const before = getVersion();
      recordChange({ source: "resources", type: "change", key: "r1" });
      recordChange({ source: "app-state", type: "delete", key: "a1" });

      const result = getChangesSince(before);
      expect(result.version).toBeGreaterThan(before);
      expect(result.events.length).toBe(2);
      expect(result.events[0].source).toBe("resources");
      expect(result.events[0].key).toBe("r1");
      expect(result.events[1].source).toBe("app-state");
      expect(result.events[1].key).toBe("a1");
    });

    it("each event has a strictly increasing version number", () => {
      const before = getVersion();
      recordChange({ source: "s", type: "change" });
      recordChange({ source: "s", type: "change" });
      recordChange({ source: "s", type: "change" });

      const result = getChangesSince(before);
      expect(result.events.length).toBe(3);
      for (let i = 1; i < result.events.length; i++) {
        expect(result.events[i].version).toBeGreaterThan(
          result.events[i - 1].version,
        );
      }
    });

    it("preserves extra properties on events", () => {
      const before = getVersion();
      recordChange({
        source: "resources",
        type: "change",
        key: "x",
        id: "res-1",
        path: "file.md",
      });

      const result = getChangesSince(before);
      expect(result.events[0].id).toBe("res-1");
      expect(result.events[0].path).toBe("file.md");
    });
  });

  describe("ring buffer overflow", () => {
    it("trims old events when buffer exceeds MAX_BUFFER (200)", () => {
      const before = getVersion();

      // Add 250 events to overflow the 200-entry buffer
      for (let i = 0; i < 250; i++) {
        recordChange({ source: "test", type: "change", key: `k${i}` });
      }

      // Requesting from way before should only get the most recent ~200
      const result = getChangesSince(before);
      // The buffer trims to MAX_BUFFER=200 when it exceeds that
      expect(result.events.length).toBeLessThanOrEqual(200);
      expect(result.version).toBeGreaterThan(before);
    });
  });
});
