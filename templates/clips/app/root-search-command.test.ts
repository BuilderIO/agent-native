import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Clips command-menu search action", () => {
  it("registers Search through the dynamic Clips command menu", () => {
    const source = readFileSync(new URL("./root.tsx", import.meta.url), "utf8");
    const menuSource = readFileSync(
      new URL("./components/clips-command-menu.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("<ClipsCommandMenu");
    expect(menuSource).toContain("useRecordingSearch(search.trim())");
    expect(menuSource).toContain("useMeetingCommandSearch(search)");
    expect(menuSource).toContain("useDictationCommandSearch(search)");
    expect(menuSource).toContain("SEARCH_FOCUS_PATH");
    expect(menuSource).toContain("openBugReportDialog");
    expect(menuSource).not.toContain("<CommandMenu.Item onSelect={() => {}}>");
  });
});
