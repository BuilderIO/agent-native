import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readSource() {
  return readFileSync(
    new URL("./factory-migrations.ts", import.meta.url),
    "utf8",
  );
}

describe("factory config Slack uniqueness migration order", () => {
  it("reconciles duplicate config rows before creating the unique Slack index", () => {
    const source = readSource();
    const version24 = source.slice(
      source.indexOf("version: 24"),
      source.indexOf("version: 25"),
    );
    const reconcileAt = version24.indexOf("reconcileDefaultFactoryConfigRows");
    const duplicateAt = version24.indexOf(
      "clearDuplicateSlackChannelAssignments",
    );
    const indexAt = version24.indexOf("CREATE UNIQUE INDEX");
    expect(reconcileAt).toBeGreaterThan(-1);
    expect(duplicateAt).toBeGreaterThan(reconcileAt);
    expect(indexAt).toBeGreaterThan(duplicateAt);
    expect(version24).toMatch(
      /sql:\s*`[\s\S]*CREATE UNIQUE INDEX IF NOT EXISTS factory_config_org_slack_channel_idx/,
    );
    expect(version24).not.toContain("getDbExec");
  });
});
