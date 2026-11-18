import { readdirSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import onboarding from "../action-conformance-onboarding.json";
import { workspaceRoot } from "../vitest.workspace-root.js";
import {
  actionContractFindings,
  assertActionConformance,
  checkActionConformance,
  type ActionConformanceFixture,
  type ActionConformanceSurface,
  type ConformanceAdapter,
} from "./action-conformance.js";
import { loadActionsFromStaticRegistry } from "./server/action-discovery.js";
import { generateActionRegistryForProject } from "./vite/action-types-plugin.js";

const templates = readdirSync(path.join(workspaceRoot, "templates")).filter(
  (name) => existsSync(path.join(workspaceRoot, "templates", name, "actions")),
);
// oracle-change: staged onboarding requested in review; the all-template audit
const onboarded = new Set<string>(onboarding.apps);
function writeReport(app: string, measurement: Record<string, unknown>): void {
  const reportDir = path.join(workspaceRoot, ".tmp/action-conformance");
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(
    path.join(reportDir, `${app}.json`),
    JSON.stringify(measurement, null, 2),
  );
}
describe("template action contracts", () => {
  it("names only existing templates in the reviewed onboarding set", () => {
    expect([...onboarded].filter((app) => !templates.includes(app))).toEqual(
      [],
    );
  });
  it.each(templates)(
    "%s inventories input and output contract coverage",
    async (app) => {
      const enforced = onboarded.has(app);
      const incomplete = {
        app,
        action: "*",
        check: "fixture",
        message: "Runtime conformance did not finish; behavior is unmeasured",
      };
      writeReport(app, {
        app,
        enforced,
        status: "incomplete",
        schemaStatus: "unmeasured",
        failures: [incomplete],
      });
      const root = path.join(workspaceRoot, "templates", app);
      generateActionRegistryForProject(root);
      const registry = await import(
        pathToFileURL(path.join(root, ".generated/actions-registry.ts")).href
      );
      const actions = loadActionsFromStaticRegistry(registry.default);
      const schemaFailures = actionContractFindings(app, actions);
      const fixturePath = path.join(
        root,
        "server/action-conformance.fixtures.ts",
      );
      const measurement = {
        app,
        actions: Object.keys(actions).length,
        schemaFailures,
        enforced,
        clientBehavior: existsSync(fixturePath)
          ? "fixture available"
          : "unmeasured: missing owned fixtures",
      };
      writeReport(app, {
        ...measurement,
        status: enforced ? "incomplete" : "inventory",
        ...(enforced ? { failures: [incomplete] } : {}),
      });
      if (!enforced) return;
      if (schemaFailures.length) {
        writeReport(app, {
          ...measurement,
          status: "failed",
          failures: schemaFailures,
        });
        assertActionConformance({
          app,
          actions: Object.keys(actions).length,
          calls: 0,
          exemptions: 0,
          failures: schemaFailures,
        });
      }
      if (!existsSync(fixturePath))
        throw new Error(
          `${app}/* fixture: missing server/action-conformance.fixtures.ts; client behavior is unmeasured`,
        );
      const { default: fixtures } = (await import(
        pathToFileURL(fixturePath).href
      )) as {
        default: {
          adapters: Record<ActionConformanceSurface, ConformanceAdapter>;
          fixtures: Record<string, ActionConformanceFixture>;
        };
      };
      const conformance = await checkActionConformance({
        app,
        actions,
        ...fixtures,
      });
      writeReport(app, {
        ...measurement,
        status: conformance.failures.length ? "failed" : "passed",
        conformance,
      });
      assertActionConformance(conformance);
    },
    240_000,
  );
});
