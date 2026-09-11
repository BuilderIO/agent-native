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
    expect(source).toContain("disabled={saving || !configLoaded}");
    expect(source).toMatch(
      /if \(!configLoaded\) \{\s*toast\.error\(t\("triage\.settingsError"\)\);\s*return;/,
    );
    expect(source).toContain(
      "automationFailureAlertEmail: form.automationFailureAlertEmail.trim()",
    );
    expect(source).toContain(
      "builderSlackUserId: form.builderSlackUserId.trim()",
    );
  });
});

describe("FactorySettingsView factory switching", () => {
  it("resets hydration when factoryId changes so Factory B cannot inherit Factory A edits", () => {
    const source = readViewSource();

    expect(source).toContain("hydratedRef.current = false");
    expect(source).toContain("dirtyRef.current = false");
    expect(source).toContain("setBaseline(null)");
    expect(source).toContain("}, [factoryId]);");
  });

  it("keeps unsaved edits when a background refetch delivers new config", () => {
    const source = readViewSource();

    expect(source).toContain(
      "if (hydratedRef.current && dirtyRef.current) return;",
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

  it("does not overwrite edits made while Save is pending", () => {
    const source = readViewSource();

    expect(source).toContain(
      '<fieldset disabled={saving} className="contents">',
    );
    expect(source).toContain(
      "if (isSameForm(trimmedForm(latestFormRef.current), submitted))",
    );
  });
});

describe("FactorySettingsView source settings", () => {
  it("does not keep Slack, GitHub, or Sentry destination and polling switches", () => {
    const source = readViewSource();
    expect(source).not.toContain("pollingEnabled");
    expect(source).not.toContain("slackChannelId");
    expect(source).not.toContain("githubPollingEnabled");
    expect(source).not.toContain("sentryPollingEnabled");
    expect(source).not.toContain("FactorySourceSettingsGroup");
  });
});

describe("FactorySettingsView danger zone", () => {
  it("requires the exact Factory name and returns to the list after deletion", () => {
    const source = readViewSource();

    expect(source).toContain('useActionMutation("delete-factory",');
    expect(source).toContain('method: "DELETE"');
    expect(source).toContain('factoryId !== "product-feedback"');
    expect(source).toContain("deleteConfirmation !== factoryName");
    expect(source).toContain("confirmName: deleteConfirmation");
    expect(source).toContain("onDeleted();");
  });
});
