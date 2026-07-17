import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const panelSource = readFileSync(
  new URL("./DatabaseValidationPanel.tsx", import.meta.url),
  "utf8",
);
const hooksPanelSource = readFileSync(
  new URL("./DatabaseHooksPanel.tsx", import.meta.url),
  "utf8",
);
const databaseViewSource = readFileSync(
  new URL("./DatabaseView.tsx", import.meta.url),
  "utf8",
);
const hookSource = readFileSync(
  new URL("../../../hooks/use-content-database.ts", import.meta.url),
  "utf8",
);

describe("Content database readiness settings", () => {
  it("mounts readiness beside hook management with the saved database config", () => {
    expect(hooksPanelSource).toContain("<DatabaseValidationPanel");
    expect(hooksPanelSource).toContain("validation={validation}");
    expect(databaseViewSource).toContain("validation={viewConfig.validation}");
  });

  it("uses the shared action surface without raw transport", () => {
    expect(panelSource).toContain(
      "useManageContentDatabaseValidation(databaseId)",
    );
    expect(hookSource).toContain('"manage-content-database-validation"');
    expect(panelSource).not.toContain("fetch(");
  });

  it("keeps editing progressive and visible truth available to viewers", () => {
    expect(panelSource).toContain("aria-expanded={expanded}");
    expect(panelSource).toContain("disabled={!canManage}");
    expect(panelSource).toContain("canManage && !gateDraft");
    expect(panelSource).toContain("draft.statusRequirements.map");
    expect(panelSource).toContain("draft.requiredForSubmission.includes");
  });

  it("uses stable property and option IDs with shadcn controls", () => {
    expect(panelSource).toContain("statusPropertyId");
    expect(panelSource).toContain("statusOptionId");
    expect(panelSource).toContain("requiredPropertyIds");
    expect(panelSource).toContain("<Checkbox");
    expect(panelSource).toContain("<Select");
  });
});
