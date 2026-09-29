import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { generateActionRegistryForProject } from "@agent-native/core/vite";
import { describe, expect, it } from "vitest";

import getDataProgram from "../../actions/get-data-program";
import {
  deriveGroundingActionNames,
  hasDataQueryAttempt,
  registerGroundingActions,
} from "./real-data-actions";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

generateActionRegistryForProject(projectRoot);
const { default: actionsRegistry } = await import(
  `${pathToFileURL(path.join(projectRoot, ".generated/actions-registry.ts")).href}?cacheBust=${Date.now()}`
);

const CORE_GROUNDING_ACTIONS = [
  "provider-api-request",
  "provider-corpus-job",
  "query-staged-dataset",
  "github-repo-files",
];

describe("grounding derivation", () => {
  it("derives the core provider-api actions from the shipped registry", () => {
    const derived = deriveGroundingActionNames(actionsRegistry);
    expect(
      CORE_GROUNDING_ACTIONS.filter((name) => !derived.includes(name)),
    ).toEqual([]);
  });

  it("leaves cached-result reads out of the derived set", () => {
    expect(getDataProgram.grounding).toBeUndefined();
    expect(deriveGroundingActionNames(actionsRegistry)).not.toContain(
      "get-data-program",
    );
  });

  it("fails at first use rather than at registration when the flag is missing", () => {
    expect(() => hasDataQueryAttempt([{ name: "gong-calls" }])).toThrow(
      /never registered/,
    );
    expect(() => registerGroundingActions([])).not.toThrow();
    expect(() => hasDataQueryAttempt([{ name: "gong-calls" }])).toThrow(
      /cannot carry the flag/,
    );
  });
});
