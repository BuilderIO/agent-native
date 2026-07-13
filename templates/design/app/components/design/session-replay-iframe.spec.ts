import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

describe("Design session replay iframe wiring", () => {
  it("bootstraps and marks inline DesignCanvas documents", () => {
    const designCanvas = source("./DesignCanvas.tsx");

    expect(designCanvas).toContain(
      "return injectSessionReplayIframeBootstrap(frameDocument);",
    );
    expect(designCanvas).toContain("SESSION_REPLAY_IFRAME_ATTRIBUTE");
  });

  it("bootstraps and marks overview and breakpoint srcdoc documents", () => {
    const multiScreenCanvas = source("./MultiScreenCanvas.tsx");

    expect(multiScreenCanvas).toContain(
      "injectSessionReplayIframeBootstrap(\n        appendHitTestResponder(",
    );
    expect(multiScreenCanvas).toContain("SESSION_REPLAY_IFRAME_ATTRIBUTE");
  });

  it("covers the home thumbnail and Present route srcdoc documents", () => {
    const home = source("../../pages/Index.tsx");
    const present = source("../../pages/Present.tsx");

    for (const content of [home, present]) {
      expect(content).toContain("injectSessionReplayIframeBootstrap");
      expect(content).toContain("SESSION_REPLAY_IFRAME_ATTRIBUTE");
    }
  });
});
