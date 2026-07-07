import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readSource(name: string): string {
  return readFileSync(new URL(name, import.meta.url), "utf8");
}

describe("recording share popover", () => {
  it("renders above the video player controls", () => {
    const shareDialogSource = readSource("./share-dialog.tsx");
    const videoPlayerSource = readSource("./video-player.tsx");

    expect(videoPlayerSource).toContain("absolute inset-0 z-10");
    expect(videoPlayerSource).toContain("absolute inset-x-0 bottom-0 z-20");
    expect(shareDialogSource).toContain("z-[260] w-[440px]");
  });
});
