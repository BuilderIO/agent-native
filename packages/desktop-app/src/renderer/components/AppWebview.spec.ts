// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  resolveAppWebviewPartition,
  resolveAppWebviewUrl,
} from "./AppWebview.js";

describe("AppWebview partition selection", () => {
  it("keeps chat-first preview webviews on the app partition", () => {
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
        partitionKey: "persist:app-app-1",
      }),
    ).toBe("persist:app-app-1");
  });

  it("keeps app tabs on their app-scoped partition", () => {
    expect(
      resolveAppWebviewPartition({
        appId: "app-1",
      }),
    ).toBe("persist:app-app-1");
  });
});

describe("AppWebview URL resolution", () => {
  const app = {
    id: "mail",
    name: "Mail",
    icon: "Mail",
    description: "Mail",
    devPort: 3003,
  };

  it("loads development apps directly instead of through the local frame", () => {
    expect(
      resolveAppWebviewUrl(app, {
        ...app,
        url: "https://mail.agent-native.com",
        devUrl: "http://localhost:3003",
        isBuiltIn: true,
        enabled: true,
        mode: "dev",
      }),
    ).toBe("http://localhost:3003");
  });

  it("uses the production URL by default", () => {
    expect(
      resolveAppWebviewUrl(app, {
        ...app,
        url: "https://mail.agent-native.com",
        devUrl: "http://localhost:3003",
        isBuiltIn: true,
        enabled: true,
      }),
    ).toBe("https://mail.agent-native.com");
  });

  it("falls back to the direct development port", () => {
    expect(
      resolveAppWebviewUrl(app, {
        ...app,
        url: "https://mail.agent-native.com",
        isBuiltIn: true,
        enabled: true,
        mode: "dev",
      }),
    ).toBe("http://localhost:3003");
  });
});
