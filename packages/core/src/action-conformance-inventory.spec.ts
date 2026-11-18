import { readdirSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, it } from "vitest";

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
describe("template action contracts", () => {
  it.each(templates)(
    "%s declares input and output contracts",
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
          },
          null,
          2,
        ),
      );
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

  it.each(templates)(
    "%s conforms through all clients with owned fixtures",
    async (app) => {
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
      assertActionConformance(
        await checkActionConformance({ app, actions, ...fixtures }),
      );
    },
    180_000,
  );
});
