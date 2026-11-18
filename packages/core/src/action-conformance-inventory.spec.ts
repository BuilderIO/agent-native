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
// continues reporting debt, while strict client contracts apply to reviewed apps.
const onboarded = new Set<string>(onboarding.apps);
describe("template action contracts", () => {
  it("names only existing templates in the reviewed onboarding set", () => {
    expect([...onboarded].filter((app) => !templates.includes(app))).toEqual(
      [],
    );
  });
  it.each(templates)(
    "%s inventories input and output contract coverage",
    async (app) => {
      const root = path.join(workspaceRoot, "templates", app);
      generateActionRegistryForProject(root);
      const registry = await import(
        pathToFileURL(path.join(root, ".generated/actions-registry.ts")).href
      );
      const actions = loadActionsFromStaticRegistry(registry.default);
      const failures = actionContractFindings(app, actions);
      const reportDir = path.join(workspaceRoot, ".tmp/action-conformance");
      mkdirSync(reportDir, { recursive: true });
      writeFileSync(
        path.join(reportDir, `${app}.json`),
        JSON.stringify(
          {
            app,
            actions: Object.keys(actions).length,
            schemaFailures: failures,
            enforced: onboarded.has(app),
            clientBehavior: existsSync(
              path.join(root, "server/action-conformance.fixtures.ts"),
            )
              ? "fixture available"
              : "unmeasured: missing owned fixtures",
          },
          null,
          2,
        ),
      );
      if (onboarded.has(app))
        assertActionConformance({
          app,
          actions: Object.keys(actions).length,
          calls: 0,
          exemptions: 0,
          failures,
        });
    },
    180_000,
  );

  it("onboarded templates conform through all clients with owned fixtures", async () => {
    for (const app of onboarded) {
      const root = path.join(workspaceRoot, "templates", app);
      const fixturePath = path.join(
        root,
        "server/action-conformance.fixtures.ts",
      );
      if (!existsSync(fixturePath)) {
        throw new Error(
          `${app}/* fixture: missing server/action-conformance.fixtures.ts; client behavior is unmeasured`,
        );
      }
      generateActionRegistryForProject(root);
      const registry = await import(
        pathToFileURL(path.join(root, ".generated/actions-registry.ts")).href
      );
      const actions = loadActionsFromStaticRegistry(registry.default);
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
      const reportDir = path.join(workspaceRoot, ".tmp/action-conformance");
      mkdirSync(reportDir, { recursive: true });
      writeFileSync(
        path.join(reportDir, `${app}.json`),
        JSON.stringify(
          {
            app,
            actions: Object.keys(actions).length,
            schemaFailures: actionContractFindings(app, actions),
            enforced: true,
            conformance,
          },
          null,
          2,
        ),
      );
      assertActionConformance(conformance);
    }
  }, 180_000);
});
