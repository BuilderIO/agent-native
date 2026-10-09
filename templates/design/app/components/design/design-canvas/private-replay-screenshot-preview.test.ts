import { describe, expect, it } from "vitest";

import { preparePrivateReplayScreenshotPreviewDocument } from "./private-replay-screenshot-preview";

describe("private replay screenshot preview bridge", () => {
  it("moves only local private screenshot sources into the parent bridge", () => {
    const route = "/api/design-board-replay-screenshots/jcs_e2e_fixture";
    const prepared = preparePrivateReplayScreenshotPreviewDocument(
      `<!doctype html><html><body><img src="${route}" srcset="${route} 2x"><img src="https://images.example.test/public.png"><img src="/api/design-board-replay-screenshots/jcs_other?cache=1"></body></html>`,
      {
        designId: "design_fixture",
        parentOrigin: "https://design.example.test",
      },
    );

    expect(prepared.screenshotPaths).toEqual([route]);
    expect(prepared.nonce).toBeTruthy();
    expect(prepared.html).toContain(
      'data-agent-native-private-replay-screenshot-index="0"',
    );
    expect(prepared.html).not.toContain(`src="${route}"`);
    expect(prepared.html).not.toContain(`srcset="${route}`);
    expect(prepared.html).toContain("https://images.example.test/public.png");
    expect(prepared.html).toContain(
      "/api/design-board-replay-screenshots/jcs_other?cache=1",
    );
    expect(prepared.html).toContain("URL.createObjectURL(data.blob)");
  });

  it("leaves documents without exact private screenshot references untouched", () => {
    const html =
      '<img src="https://design.example.test/api/design-board-replay-screenshots/jcs_e2e_fixture">';

    expect(
      preparePrivateReplayScreenshotPreviewDocument(html, {
        designId: "design_fixture",
        parentOrigin: "https://design.example.test",
      }),
    ).toEqual({ html, screenshotPaths: [], nonce: null });
  });

  it("removes private screenshot sources when there is no owning design scope", () => {
    const route = "/api/design-board-replay-screenshots/jcs_e2e_fixture";
    const prepared = preparePrivateReplayScreenshotPreviewDocument(
      `<img src="${route}">`,
      { parentOrigin: "https://design.example.test" },
    );

    expect(prepared.screenshotPaths).toEqual([]);
    expect(prepared.nonce).toBeNull();
    expect(prepared.html).not.toContain(`src="${route}"`);
    expect(prepared.html).not.toContain(
      "design-private-replay-screenshot:connect",
    );
  });
});
