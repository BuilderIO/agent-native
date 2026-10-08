import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * A screenshot edit replaces the stored file but not its address: both the
 * before and after picture are served from `/api/thumbnail/<id>`. React then
 * re-renders with a `src` string identical to the one already on the element,
 * the browser makes no new request at all, and the redaction the user just
 * burned in never appears — it looks like the save silently failed, until the
 * page is reloaded by hand.
 *
 * `mediaUpdatedAt` is the version, and `save-screenshot-edits` sets it. These
 * assertions are on the source rather than a render because what matters is
 * that nobody reintroduces the bare URL at the call site.
 */
function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("screenshot media version", () => {
  it("versions the screenshot on the owner's recording page", () => {
    const source = readSource("./_app.r.$recordingId.tsx");
    const stage = source.match(/<ScreenshotStage[\s\S]*?\/>/)?.[0];

    expect(stage).toContain("withMediaVersion(");
    expect(stage).toContain("recording.mediaUpdatedAt");
    // The bare URL straight into `src` is the bug this guards.
    expect(stage).not.toMatch(/src=\{\s*recording\.imageUrl/);
  });

  it("versions the base image the editor draws on", () => {
    const source = readSource("./_app.r.$recordingId.tsx");
    const editor = source.match(/<ScreenshotEditor[\s\S]*?\/>/)?.[0];

    expect(editor).toContain("withMediaVersion(");
    expect(editor).toContain("recording.mediaUpdatedAt");
  });

  it("versions the screenshot on a share link", () => {
    const source = readSource("./share.$shareId.tsx");
    const stage = source.match(/<ScreenshotStage[\s\S]*?\/>/)?.[0];

    expect(stage).toContain("withMediaVersion(");
    expect(stage).toContain("recording.mediaUpdatedAt");
    expect(stage).not.toMatch(/src=\{\s*recording\.imageUrl/);
  });

  it("sends mediaUpdatedAt to the player, or there is no version to use", () => {
    const source = readSource("../../actions/get-recording-player-data.ts");

    expect(source).toContain("mediaUpdatedAt: rec.mediaUpdatedAt");
  });
});
