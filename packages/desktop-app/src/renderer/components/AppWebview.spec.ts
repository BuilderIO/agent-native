// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { resolveAppWebviewPartition } from "./AppWebview.js";

describe("AppWebview partition selection", () => {
  it("keeps chat-first preview webviews on an isolated partition", () => {
    expect(
      resolveAppWebviewPartition({
        appId: "app-1",
        sourceUrl: "https://preview.example.com",
      }),
    ).toBe("persist:chat-first-browser");
    expect(
      resolveAppWebviewPartition({
        appId: "app-1",
        sourceUrl: "https://preview.example.com",
        partitionKey: "persist:chat-first-preview-app-1",
      }),
    ).toBe("persist:chat-first-preview-app-1");
  });

  it("keeps app tabs on their app-scoped partition", () => {
    expect(
      resolveAppWebviewPartition({
        appId: "app-1",
      }),
    ).toBe("persist:app-app-1");
  });
});
