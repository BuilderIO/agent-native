import { afterEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ mountPath: "/forms-2" }));

vi.mock("@agent-native/core/client/api-path", () => ({
  appBasePath: () => mock.mountPath,
}));

import {
  DEFAULT_EMBED_OPTIONS,
  embedCode,
} from "@/components/share/embed-code";

import { publicBaseUrl, publicFormUrl } from "./public-url";

afterEach(() => {
  vi.unstubAllGlobals();
  mock.mountPath = "/forms-2";
});

function atOrigin(origin: string) {
  vi.stubGlobal("window", { location: { origin } });
}

describe("public URLs", () => {
  it("mounts public form links under the app base path", () => {
    atOrigin("https://forms.example.test");
    expect(publicFormUrl("f1")).toBe("https://forms.example.test/forms-2/f/f1");
  });

  it("stays at the origin when the app is mounted at the root", () => {
    mock.mountPath = "";
    atOrigin("https://forms.example.test");
    expect(publicFormUrl("f1")).toBe("https://forms.example.test/f/f1");
    expect(publicBaseUrl()).toBe("https://forms.example.test");
  });

  it("carries the app mount into the embed code and its script", () => {
    atOrigin("https://forms.example.test");
    const code = embedCode(
      publicBaseUrl(),
      "f1",
      "standard",
      DEFAULT_EMBED_OPTIONS,
    );
    expect(code).toContain("https://forms.example.test/forms-2/embed/f1?");
    expect(code).toContain("https://forms.example.test/forms-2/forms-embed.js");
  });

  it("is relative until the browser knows its origin", () => {
    vi.stubGlobal("window", undefined);
    expect(publicFormUrl("f1")).toBe("/forms-2/f/f1");
  });
});
