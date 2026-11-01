import { describe, expect, it } from "vitest";

import {
  APP_STATE_BATCH_ROUTE_HEADER,
  APP_STATE_SEQ_HEADER,
  APP_STATE_WRITER_HEADER,
  TAB_SCOPED_APP_STATE_KEYS,
} from "./app-state-routes";

describe("TAB_SCOPED_APP_STATE_KEYS", () => {
  it("lists exactly the keys the server stores once per tab", () => {
    expect([...TAB_SCOPED_APP_STATE_KEYS].sort()).toEqual([
      "__set_url__",
      "__url__",
      "navigate",
      "navigation",
      "pending-selection-context",
      "settings-view",
    ]);
  });

  it("leaves shared keys and tab-suffixed rows out", () => {
    for (const key of [
      "localization",
      "content-history",
      "navigation:tab-1",
      "Navigation",
      "",
    ]) {
      expect(TAB_SCOPED_APP_STATE_KEYS.has(key)).toBe(false);
    }
  });
});

describe("APP_STATE_BATCH_ROUTE_HEADER", () => {
  it("names the header the batch route sets and the client reads", () => {
    expect(APP_STATE_BATCH_ROUTE_HEADER).toBe("X-Agent-Native-App-State-Batch");
  });

  it("is a header name a fetch answer can carry and be read by", () => {
    const headers = new Headers({ [APP_STATE_BATCH_ROUTE_HEADER]: "1" });
    expect(headers.get(APP_STATE_BATCH_ROUTE_HEADER)).toBe("1");
    expect(headers.get("x-agent-native-app-state-batch")).toBe("1");
  });
});

describe("write order headers", () => {
  it("names the headers a page numbers its writes with", () => {
    expect(APP_STATE_WRITER_HEADER).toBe("X-Agent-Native-App-State-Writer");
    expect(APP_STATE_SEQ_HEADER).toBe("X-Agent-Native-App-State-Seq");
  });

  it("are header names a request can carry", () => {
    const headers = new Headers({
      [APP_STATE_WRITER_HEADER]: "page-1",
      [APP_STATE_SEQ_HEADER]: "7",
    });
    expect(headers.get(APP_STATE_WRITER_HEADER)).toBe("page-1");
    expect(headers.get(APP_STATE_SEQ_HEADER)).toBe("7");
  });
});
