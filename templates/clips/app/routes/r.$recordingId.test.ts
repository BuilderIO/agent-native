import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function readRoute(name: string): string {
  return readFileSync(resolve(process.cwd(), "app/routes", name), "utf8");
}

describe("direct recording route shell cue", () => {
  it("keeps the main header return control icon-only and shared", () => {
    const route = readRoute("r.$recordingId.tsx");
    const headerStart = route.indexOf(
      'className="flex min-w-0 shrink-0 items-center gap-2 border-b border-border px-3 py-2',
    );
    expect(headerStart).toBeGreaterThan(-1);

    const header = route.slice(
      headerStart,
      route.indexOf('<div className="flex-1 min-w-0">', headerStart),
    );

    expect(header).toContain("<BackButton");
    expect(header).not.toContain('className="hidden sm:inline"');

    const controlStart = route.indexOf("export function BackButton(");
    const control = route.slice(
      controlStart,
      route.indexOf("function parseTimeParam", controlStart),
    );
    expect(control).toContain('size="icon"');
    expect(control).toContain('aria-label={t("recordingPage.backToLibrary")}');
    expect(control).toContain("<TooltipContent");
  });
});
