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

  it("uses the app-standard line tabs for history filters", () => {
    const filterStart = routeSource.indexOf("function FilterTabs");
    const filterEnd = routeSource.indexOf("function WebDictationPanel");
    const filterSource = routeSource.slice(filterStart, filterEnd);

    expect(filterSource).toContain("<TabsList");
    expect(filterSource).toContain('variant="line"');
    expect(filterSource).not.toContain("rounded-full");
  });

  it("keeps dictionary management in the page toolbar", () => {
    expect(routeSource).toContain("<VocabularyManager />");
    expect(routeSource).not.toContain("<VocabularySection");
  });

  it("uses one action-led empty state before showing the workspace", () => {
    const emptyStart = routeSource.indexOf("function DictateEmptyState");
    const emptyEnd = routeSource.indexOf(
      "export default function DictateRoute",
    );
    const emptySource = routeSource.slice(emptyStart, emptyEnd);

    expect(emptySource).toContain("<Empty");
    expect(emptySource).toContain("<EmptyDescription");
    expect(emptySource).toContain("<CaptureInstallButton");
    expect(emptySource).toContain('t("dictateRoute.tryInBrowser")');
    expect(routeSource).toContain("isEmpty && !hasActiveBrowserCapture");
  });
});
