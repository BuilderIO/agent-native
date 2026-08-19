import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readViewSource() {
  return readFileSync(
    new URL("./FactorySettingsView.tsx", import.meta.url),
    "utf8",
  );
}

describe("FactorySettingsView load gating", () => {
  it("blocks the settings form and save until triage config is readable", () => {
    const source = readViewSource();

    expect(source).toContain(
      "const configLoaded = Boolean(query.data) && !query.isError;",
    );
    expect(source).toContain("if (!configLoaded) {");
    expect(source).toContain("ActionQueryError");
    expect(source).toContain("onRetry={() => void query.refetch()}");
    expect(source).toContain("disabled={mutation.isPending || !configLoaded}");
    expect(source).toMatch(
      /if \(!configLoaded\) \{\s*toast\.error\(t\("triage\.settingsError"\)\);\s*return;/,
    );
  });
});
