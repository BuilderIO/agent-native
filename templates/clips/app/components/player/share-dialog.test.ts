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

  it("keeps human and agent links visible for every visibility", () => {
    const shareDialogSource = readSource("./share-dialog.tsx");

    expect(shareDialogSource).toContain(
      'label={t("shareDialog.shareWithHumans")}',
    );
    expect(shareDialogSource).toContain(
      'label={t("shareDialog.shareWithAgents")}',
    );
    expect(shareDialogSource).toContain(
      "const agentLink = isPublic ? shareUrl : agentContextUrl",
    );
    expect(shareDialogSource).toContain("if (!isPublic)");
    expect(shareDialogSource).not.toContain("Collapsible");
  });

  it("uses known recording access while share details load", () => {
    const shareDialogSource = readSource("./share-dialog.tsx");

    expect(shareDialogSource).toContain("data?.role ?? initialRole");
    expect(shareDialogSource).toContain("initialVisibility ??");
    expect(shareDialogSource).not.toContain('?? "private"');
  });
});
