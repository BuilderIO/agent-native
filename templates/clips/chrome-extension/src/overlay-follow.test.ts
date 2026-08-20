import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Clips overlay follow permissions", () => {
  it("gates page error telemetry on active recording and guards reinjection", () => {
    const contentScriptSource = readFileSync(
      new URL("./content-script.ts", import.meta.url),
      "utf8",
    );

    expect(contentScriptSource).toMatch(
      /function reportContentScriptError[\s\S]*?if \(!recordingActive\) return;/,
    );
    expect(contentScriptSource).toContain(
      "chrome.storage.onChanged.addListener",
    );
    expect(contentScriptSource).toContain(
      "if (flags.__clipsOverlayHostReady) return;",
    );
  });

  it("keeps cross-tab follow enabled and declares the broad-host manifest path", () => {
    const backgroundSource = readFileSync(
      new URL("./background.ts", import.meta.url),
      "utf8",
    );
    expect(backgroundSource).toContain(
      "const CROSS_TAB_FOLLOW: boolean = true;",
    );

    const manifest = JSON.parse(
      readFileSync(new URL("../public/manifest.json", import.meta.url), "utf8"),
    ) as {
      host_permissions?: string[];
      content_scripts?: Array<{
        matches?: string[];
        js?: string[];
        run_at?: string;
        all_frames?: boolean;
      }>;
    };

    expect(manifest.host_permissions).toEqual(
      expect.arrayContaining(["<all_urls>"]),
    );

    const overlayScript = manifest.content_scripts?.find((entry) =>
      entry.js?.includes("assets/content-script.js"),
    );
    expect(overlayScript).toEqual(
      expect.objectContaining({
        matches: expect.arrayContaining(["<all_urls>"]),
        js: ["assets/content-script.js"],
        run_at: "document_idle",
        all_frames: false,
      }),
    );
  });
});
