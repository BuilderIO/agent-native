import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parityActionAllowlist } from "../exceptions.allowlist";
import { parityMatrix } from "../matrix";

const actionsDir = new URL("../../actions/", import.meta.url);

function actionIds() {
  return readdirSync(actionsDir)
    .filter((file) => file.endsWith(".ts"))
    .filter((file) => !file.startsWith("_"))
    .filter((file) => !file.endsWith(".test.ts"))
    .filter((file) => !file.endsWith(".db.test.ts"))
    .filter((file) => !file.endsWith(".live.test.ts"))
    .map((file) => file.replace(/\.ts$/, ""))
    .sort();
}

function isHiddenAgentAction(action: string) {
  const source = readFileSync(new URL(`${action}.ts`, actionsDir), "utf8");
  return /agentTool:\s*false/.test(source);
}

describe("Content parity matrix action coverage", () => {
  it("covers every non-private action or documents why it is outside the matrix", () => {
    const represented = new Set(parityMatrix.flatMap((row) => row.actions));
    const allowlisted = new Set(
      parityActionAllowlist.map((entry) => entry.action),
    );
    const missing = actionIds().filter(
      (action) => !represented.has(action) && !allowlisted.has(action),
    );

    expect(missing).toEqual([]);
  });

  it("does not allowlist hidden agent actions away from explicit exception rows", () => {
    const represented = new Set(parityMatrix.flatMap((row) => row.actions));
    const hiddenAllowlisted = parityActionAllowlist
      .map((entry) => entry.action)
      .filter(isHiddenAgentAction);
    const hiddenUnrepresented = actionIds()
      .filter(isHiddenAgentAction)
      .filter((action) => !represented.has(action));

    expect(hiddenAllowlisted).toEqual([]);
    expect(hiddenUnrepresented).toEqual([]);
  });

  it("requires allowlist entries to point at real non-hidden actions", () => {
    const known = new Set(actionIds());
    const invalid = parityActionAllowlist
      .filter(
        (entry) =>
          !known.has(entry.action) || isHiddenAgentAction(entry.action),
      )
      .map((entry) => entry.action);

    expect(invalid).toEqual([]);
  });
});
