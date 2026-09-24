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

// The hand-maintained DATA_QUERY_ACTIONS allowlist is gone, so no file in this
// template names these actions any more. They are defined in
// @agent-native/core and re-exported here, which means a core build that drops
// `grounding: true` sends every grounded provider answer to the "connect data
// sources" fallback with nothing failing. This is the only check between that
// regression and production; provider-api-request is the recommended path for
// every provider integration, so it is also the most-used one.
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

  // Runs last on purpose: "never registered" is a state this module cannot be
  // returned to once anything registers.
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
