import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { dictationsRefetchInterval } from "./_app.dictate";

describe("dictate list refresh", () => {
  it("polls while browser dictation work is active", () => {
    expect(dictationsRefetchInterval(true)).toBe(2_000);
  });

  it("stops polling when history page is idle", () => {
    expect(dictationsRefetchInterval(false)).toBe(false);
  });
});

describe("dictate page composition", () => {
  const routeSource = readFileSync(
    new URL("./_app.dictate.tsx", import.meta.url),
    "utf8",
  );

  it("uses shadcn items instead of source-filter tabs and a table", () => {
    expect(routeSource).toContain("<DayHeader");
    expect(routeSource).toContain("formatDayLabel");
    expect(routeSource).toContain("groupByCalendarDay");
    expect(routeSource).toContain("<ItemGroup");
    expect(routeSource).toMatch(/<Item\s+asChild/);
    expect(routeSource).not.toContain("<ItemMedia");
    expect(routeSource).toContain("<ItemDescription");
    expect(routeSource).toContain("<ItemActions");
    expect(routeSource).toContain("<Badge");
    expect(routeSource).toContain('<Badge variant="outline">{label}</Badge>');
    expect(routeSource).toContain("<CollapsibleContent");
    expect(routeSource).toContain(
      'className="clips-collapsible-content w-full"',
    );
    expect(routeSource).toContain("<CollapsibleTrigger");
    expect(routeSource).toContain('document.addEventListener("pointerdown"');
    expect(routeSource).toContain("setExpanded((value) => !value)");
    expect(routeSource).toContain("<TabsList");
    expect(routeSource).toContain("<TabsTrigger");
    expect(routeSource).toContain("<IconTrash");
    expect(routeSource).toContain('"delete-dictation"');
    expect(routeSource).toContain('size="icon"');
    expect(routeSource).toContain('aria-label={t("dictateRoute.copy")}');
    expect(routeSource).toContain(
      'aria-label={t("dictateRoute.cleanupWithAi")}',
    );
    expect(routeSource).toContain("actionErrorMessage(error)");
    expect(routeSource).toContain('t("dictateRoute.cleanupComplete")');
    expect(routeSource).toContain('t("dictateRoute.cleanupFailed")');
    expect(routeSource).not.toContain("function FilterTabs");
    expect(routeSource).not.toContain("grid-cols-12");
    expect(routeSource).not.toContain("<DayGroupedCard");
  });

  it("keeps dictionary management in the page toolbar", () => {
    expect(routeSource).toContain("<VocabularyManager />");
    expect(routeSource).not.toContain("<VocabularySection");
  });

  it("uses the library toolbar pattern for the primary dictation action", () => {
    expect(routeSource).toContain("<PageHeaderPrimaryAction");
    expect(routeSource).toContain(
      "(dictations.length > 0 || hasCaptureActivity) &&",
    );
    expect(routeSource).toContain('t("dictateRoute.newDictation")');
    expect(routeSource).toContain("<DictationCaptureStatus");
    expect(routeSource).toContain("<DictationEmptyState");
    expect(routeSource).toContain("<CaptureInstallButton");
    expect(routeSource).toContain("isDesktopApp");
    expect(routeSource).toContain("speechSupported");
    expect(routeSource).not.toContain('t("dictateRoute.recordOnDesktop")');
    expect(routeSource).toContain("<AppEmptyState");
    expect(routeSource).toContain(
      'className="flex min-h-0 flex-1 flex-col overflow-y-auto p-5"',
    );
    expect(routeSource).not.toContain("DesktopPlatformIcon");
    expect(routeSource).not.toContain("IconPlus");
    expect(routeSource).not.toContain("<WebDictationPanel");
    expect(routeSource).not.toContain('t("dictateRoute.startDictation")');
    expect(routeSource).not.toContain("DownloadDesktopAppCard");
  });

  it("does not render playback controls for text-only dictations", () => {
    expect(routeSource).not.toContain("DictationPlayback");
    expect(routeSource).not.toContain("<audio");
    expect(routeSource).not.toContain("computePeaks");
  });

  it("uses progressive disclosure for the full transcript", () => {
    expect(routeSource).toContain("line-clamp-2");
    expect(routeSource).toContain("displayText");
    expect(routeSource).not.toContain("md:grid-cols-2");
    expect(routeSource).not.toContain('t("dictateRoute.cleanupHint")');
    expect(routeSource).not.toContain('"segmented"');
    expect(routeSource).not.toContain("dictation.segments");
    expect(routeSource).not.toContain('t("dictateRoute.transcriptInfo")');
    expect(routeSource).not.toContain('t("dictateRoute.replaceOriginal")');
  });
});
