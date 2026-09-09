import { describe, expect, it } from "vitest";

import {
  createHistorySession,
  HISTORY_IDLE_MS,
} from "./document-history-session";

describe("human history grouping", () => {
  it("keeps continuous work together and separates inactivity, navigation, and restore", () => {
    let id = 0;
    const session = createHistorySession(() => String(++id));
    expect(session.activity("a", 0)).toBe("1");
    expect(session.activity("a", HISTORY_IDLE_MS - 1)).toBe("1");
    expect(session.activity("a", HISTORY_IDLE_MS)).toBe("1");
    expect(session.activity("a", HISTORY_IDLE_MS * 2)).toBe("2");
    expect(session.activity("b", HISTORY_IDLE_MS * 2 + 1)).toBe("3");
    expect(session.activity("a", HISTORY_IDLE_MS * 2 + 2)).toBe("4");
    session.reset();
    expect(session.activity("a", HISTORY_IDLE_MS * 2 + 3)).toBe("5");
  });
  it("does not reuse identity after a reload or across tabs", () => {
    let id = 0;
    const ids = () => String(++id);
    expect(createHistorySession(ids).activity("a", 0)).not.toBe(
      createHistorySession(ids).activity("a", 0),
    );
  });
});
