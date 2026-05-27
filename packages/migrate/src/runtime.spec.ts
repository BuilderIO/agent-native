import { describe, expect, it } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { nextjsSourceAdapter } from "./adapters/nextjs.js";
import { agentNativeTargetAdapter } from "./adapters/agent-native-target.js";
import { createDefaultVerifiers } from "./verifiers/deterministic.js";
import {
  approveMigrationRun,
  createMigrationRun,
  discoverMigration,
  discoverMigrationWithAgent,
  discoverMigrationWithAgentIntrospection,
  migrationContext,
  planMigration,
  verifyMigration,
} from "./runtime.js";
import { selectSourceAdapter } from "./adapters/source-registry.js";
import type { ProjectIR, SourceAdapter } from "./types.js";
import { createBrowserVerifier } from "./verifiers/browser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("migration runtime", () => {
  it("runs discover, plan, approve, scaffold, and verify", async () => {
    const sourceRoot = path.join(
      path.resolve(__dirname, "."),
      "__fixtures__/next-pages",
    );
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "an-migrate-"));
    const outputRoot = path.join(tmp, "migrated-app");
    const artifactRoot = path.join(tmp, "artifacts");

    let run = await createMigrationRun({
      sourceRoot,
      outputRoot,
      artifactRoot,
    });
    const discovered = await discoverMigration(run, nextjsSourceAdapter);
    run = discovered.run;
    const planned = await planMigration(run, discovered.ir);
    run = await approveMigrationRun(planned.run);

    const context = migrationContext(run, discovered.ir, planned.tasks);
    const result = await agentNativeTargetAdapter.scaffold(context);
    expect(result.ok).toBe(true);
    expect(result.changedFiles).toContain("package.json");

    const report = await verifyMigration(context, createDefaultVerifiers());
    expect(report.ok).toBe(true);
    await expect(
      fs.stat(path.join(artifactRoot, run.id, "01-assessment.md")),
    ).resolves.toBeTruthy();
    await expect(
      fs.stat(path.join(outputRoot, "actions/view-screen.ts")),
    ).resolves.toBeTruthy();
  });

  it("namespaces task ids per run so repeated assessments can share a database", async () => {
    const sourceRoot = path.join(
      path.resolve(__dirname, "."),
      "__fixtures__/next-pages",
    );
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "an-migrate-ids-"));
    const artifactRoot = path.join(tmp, "artifacts");

    const firstRun = await createMigrationRun({
      sourceRoot,
      outputRoot: path.join(tmp, "first-output"),
      artifactRoot,
      id: "mig_first",
    });
    const secondRun = await createMigrationRun({
      sourceRoot,
      outputRoot: path.join(tmp, "second-output"),
      artifactRoot,
      id: "mig_second",
    });

    const firstDiscovered = await discoverMigration(
      firstRun,
      nextjsSourceAdapter,
    );
    const secondDiscovered = await discoverMigration(
      secondRun,
      nextjsSourceAdapter,
    );
    const firstPlan = await planMigration(
      firstDiscovered.run,
      firstDiscovered.ir,
    );
    const secondPlan = await planMigration(
      secondDiscovered.run,
      secondDiscovered.ir,
    );

    expect(firstPlan.tasks.length).toBeGreaterThan(0);
    expect(secondPlan.tasks.length).toBe(firstPlan.tasks.length);
    expect(
      firstPlan.tasks.every((task) => task.id.startsWith("mig_first:")),
    ).toBe(true);
    expect(
      secondPlan.tasks.every((task) => task.id.startsWith("mig_second:")),
    ).toBe(true);
    expect(
      new Set([...firstPlan.tasks, ...secondPlan.tasks].map((task) => task.id))
        .size,
    ).toBe(firstPlan.tasks.length + secondPlan.tasks.length);
  });

  it("writes fallback discovery artifacts and plans from skeleton IR", async () => {
    const tmp = await fs.mkdtemp(
      path.join(os.tmpdir(), "an-migrate-fallback-"),
    );
    const run = await createMigrationRun({
      sourceRoot: "A private dashboard for invoices and approval workflows",
      inputKind: "description",
      outputRoot: path.join(tmp, "migrated-app"),
      artifactRoot: path.join(tmp, "artifacts"),
      id: "mig_fallback",
    });

    const discovered = await discoverMigrationWithAgentIntrospection(run);
    const irJson = JSON.parse(
      await fs.readFile(path.join(run.artifactDir, "ir.json"), "utf-8"),
    );

    expect(discovered.run.phase).toBe("plan");
    expect(irJson.site.metadata.needsAgentIntrospection).toBe(true);
    await expect(fs.stat(discovered.assessmentPath)).resolves.toBeTruthy();
    const assessment = await fs.readFile(discovered.assessmentPath, "utf-8");
    expect(assessment).toContain("Assessment source: `agent-introspection`");
    expect(assessment).toContain("Needs agent introspection: yes");

    const planned = await planMigration(discovered.run, discovered.ir);
    expect(planned.tasks.map((task) => task.recipeName)).toEqual(
      expect.arrayContaining([
        "mutations-to-optimistic-actions",
        "logged-in-pages-to-client-app-shell",
      ]),
    );
  });

  it("adds custom AEM, Builder, and jQuery plan input tasks", async () => {
    const tmp = await fs.mkdtemp(
      path.join(os.tmpdir(), "an-migrate-plan-inputs-"),
    );
    const run = await createMigrationRun({
      sourceRoot:
        "AEM site with Content Fragments, Experience Fragments, and jQuery clientlibs",
      inputKind: "description",
      outputRoot: path.join(tmp, "migrated-app"),
      artifactRoot: path.join(tmp, "artifacts"),
      id: "mig_plan_inputs",
    });
    const discovered = await discoverMigrationWithAgentIntrospection(run);

    const planned = await planMigration(discovered.run, discovered.ir, {
      planInputs: {
        summary: "Controlled AEM to Agent-Native + Builder migration",
        aem: {
          modes: ["crawl", "api", "package", "code"],
          contentFragmentPolicy: "headless",
          experienceFragmentPolicy: "builder-section",
          componentPolicy: "builder-registered-component",
        },
        builder: {
          enabled: true,
          componentRegistration: "register",
          routeOwnership: [
            { pattern: "static/low-change pages", owner: "builder-page" },
            { pattern: "dynamic pages", owner: "headless" },
          ],
        },
        headless: {
          provider: "Akeneo",
          routePatterns: ["dynamic pages"],
        },
        jquery: { policy: "rewrite" },
        verification: {
          sampleSize: 3,
          required: ["screenshots", "DOM/text parity"],
        },
      },
    });

    expect(planned.tasks.map((task) => task.recipeName)).toEqual(
      expect.arrayContaining([
        "aem-evidence-inventory",
        "aem-content-fragments-to-target-models",
        "aem-experience-fragments-to-components",
        "aem-components-to-react",
        "builder-component-registration-plan",
        "route-ownership-map",
        "headless-dynamic-route-map",
        "jquery-clientlibs-to-react",
        "sample-sweep-verification",
      ]),
    );
    expect(
      planned.tasks
        .filter((task) => task.id.includes(":plan-input-"))
        .every((task) => task.id.startsWith("mig_plan_inputs:")),
    ).toBe(true);

    const plan = await fs.readFile(planned.planPath, "utf-8");
    expect(plan).toContain("Custom Plan Inputs");
    expect(plan).toContain("AEM modes: crawl, api, package, code");
    await expect(
      fs.stat(path.join(run.artifactDir, "02-plan-inputs.json")),
    ).resolves.toBeTruthy();
    const tasksJson = JSON.parse(
      await fs.readFile(path.join(run.artifactDir, "tasks.json"), "utf-8"),
    );
    expect(tasksJson).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ recipeName: "jquery-clientlibs-to-react" }),
      ]),
    );
  });

  it("matches literal question marks in plan input route patterns", async () => {
    const tmp = await fs.mkdtemp(
      path.join(os.tmpdir(), "an-migrate-route-patterns-"),
    );
    const run = await createMigrationRun({
      sourceRoot: "Route ownership fixture",
      inputKind: "description",
      outputRoot: path.join(tmp, "migrated-app"),
      artifactRoot: path.join(tmp, "artifacts"),
      id: "mig_route_patterns",
    });
    const ir: ProjectIR = {
      site: {
        framework: "unknown",
        sourceRoot: run.sourceRoot,
        routes: [
          {
            id: "literal-query",
            path: "/users/?id",
            filePath: "pages/users.tsx",
            router: "unknown",
            kind: "app",
            dynamic: false,
            public: true,
          },
          {
            id: "path-id",
            path: "/users/id",
            filePath: "pages/users-id.tsx",
            router: "unknown",
            kind: "app",
            dynamic: false,
            public: true,
          },
        ],
        redirects: [],
        metadata: {},
      },
      components: { components: [], designTokens: {} },
      content: { models: [], assets: [] },
      behavior: {
        apiEndpoints: [],
        dataStores: [],
        llmCalls: [],
        clientState: [],
        auth: [],
        jobs: [],
      },
    };

    const planned = await planMigration(run, ir, {
      planInputs: {
        builder: {
          enabled: true,
          routeOwnership: [{ pattern: "/users/?id", owner: "builder-page" }],
        },
      },
    });

    expect(
      planned.tasks.find((task) => task.recipeName === "route-ownership-map")
        ?.targetIds,
    ).toEqual(["literal-query"]);
  });

  it("selects matching deterministic adapters from a registry", async () => {
    const adapter: SourceAdapter = {
      id: "legacy-description",
      label: "Legacy Description",
      kind: "deterministic",
      inputKinds: ["description"],
      async detect(sourceRoot) {
        return sourceRoot.includes("legacy portal");
      },
      async introspect(sourceRoot) {
        const discovered = await discoverMigrationWithAgent(
          await createMigrationRun({
            sourceRoot,
            inputKind: "description",
            outputRoot: "/tmp/unused-output",
            artifactRoot: await fs.mkdtemp(
              path.join(os.tmpdir(), "an-migrate-adapter-"),
            ),
          }),
        );
        return discovered.ir;
      },
    };

    await expect(
      selectSourceAdapter({
        sourceRoot: "legacy portal with reports",
        inputKind: "description",
        registry: [adapter],
      }),
    ).resolves.toBe(adapter);
    await expect(
      selectSourceAdapter({
        sourceRoot: "legacy portal with reports",
        inputKind: "path",
        registry: [adapter],
      }),
    ).resolves.toBeNull();
  });

  it("browser verifier records a skipped artifact without baseUrl", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "an-migrate-browser-"));
    const run = await createMigrationRun({
      sourceRoot: "https://example.com",
      inputKind: "url",
      outputRoot: path.join(tmp, "out"),
      artifactRoot: path.join(tmp, "artifacts"),
    });
    const discovered = await discoverMigrationWithAgent(run);
    const verifier = createBrowserVerifier();
    const result = await verifier.run(
      migrationContext(discovered.run, discovered.ir, []),
    );
    expect(result.ok).toBe(true);
    expect(result.severity).toBe("info");
    await expect(fs.stat(result.artifactPaths[0]!)).resolves.toBeTruthy();
  });
});
