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

  it("keeps agent sharing private-only and lazy", () => {
    const shareDialogSource = readSource("./share-dialog.tsx");

    expect(shareDialogSource).toContain("{sharesLoaded && !isPublic ? (");
    expect(shareDialogSource).toContain("if (!isPublic && agentShareOpen)");
    expect(shareDialogSource).toContain("{isPublic ? <SlackShareHint");
  });

  it("uses known recording access while share details load", () => {
    const shareDialogSource = readSource("./share-dialog.tsx");

    expect(shareDialogSource).toContain("data?.role ?? initialRole");
    expect(shareDialogSource).toContain("initialVisibility ??");
    expect(shareDialogSource).not.toContain('?? "private"');
  });
});
