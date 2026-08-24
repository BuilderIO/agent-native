import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const useAppsSource = readFileSync(
  new URL("./use-apps.ts", import.meta.url),
  "utf8",
);
const appScreenSource = readFileSync(
  new URL("../app/app/[id].tsx", import.meta.url),
  "utf8",
);

describe("mobile app inventory recovery", () => {
  it("settles the loading state when local storage fails", () => {
    expect(useAppsSource).toContain("catch (cause)");
    expect(useAppsSource).toContain("setError");
    expect(useAppsSource).toContain("finally");
    expect(useAppsSource).toContain("setLoading(false)");
  });

  it("offers retry and back controls after an inventory failure", () => {
    expect(appScreenSource).toContain("appsError");
    expect(appScreenSource).toContain("appsError && !isWorkspaceApp");
    expect(appScreenSource).toContain("reloadApps");
    expect(appScreenSource).toContain(
      'accessibilityLabel="Retry loading apps"',
    );
    expect(appScreenSource).toContain('accessibilityLabel="Back to apps"');
    expect(appScreenSource).toContain('router.replace("/more" as never)');
  });
});
