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
    expect(source).toContain(
      "automationFailureAlertEmail: automationFailureAlertEmail.trim()",
    );
  });
});

describe("FactorySettingsView unsaved-change bar", () => {
  it("saves from a sticky bar that only appears while the form is dirty", () => {
    const source = readViewSource();

    expect(source).toContain("const dirty = baseline !== null");
    expect(source).toMatch(/\{dirty \? \(\s*<div className="sticky top-0/);
    expect(source).toContain('t("triage.unsavedSettings")');
    expect(source).toContain('t("triage.discardSettingsChanges")');
    // The bar is the only save control; a second one at the bottom of a long
    // page is what made saving invisible.
    expect(source.match(/t\("triage\.saveSettings"\)/g)).toHaveLength(1);
  });

  it("keeps unsaved edits when a background refetch delivers new config", () => {
    const source = readViewSource();

    expect(source).toContain(
      "if (hydratedRef.current && dirtyRef.current) return;",
    );
  });
});
