import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("desktop app webview mounting", () => {
  it("keeps warmed webviews mounted while switching the active app", () => {
    const appSource = readFileSync(
      new URL("./App.tsx", import.meta.url),
      "utf8",
    );

    expect(appSource).toContain("key={tab.id}");
    expect(appSource).not.toContain("key={activeApp.id}");
  });
});
