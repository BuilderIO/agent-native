import fs from "fs/promises";
import os from "os";
import path from "path";

import { describe, expect, it } from "vitest";

import {
  approveMigrationRun,
  createMigrationRun,
  migrationContext,
} from "../runtime.js";
import type { MigrationContext, ProjectIR, SiteRoute } from "../types.js";
import { createSkeletonProjectIR } from "./agent-introspection.js";
import {
  agentNativeTargetAdapter,
  scaffoldAgentNativeTarget,
  verifyAgentNativeConformance,
} from "./agent-native-target.js";

const REQUIRED_CONFORMANCE_FILES = [
  "actions/run.ts",
  "actions/view-screen.ts",
  "actions/navigate.ts",
  "app/root.tsx",
  "server/plugins/agent-chat.ts",
];

async function createApprovedContext(prefix: string): Promise<{
  tmp: string;
  outputRoot: string;
  artifactRoot: string;
  context: MigrationContext;
}> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const outputRoot = path.join(tmp, "migrated-app");
  const artifactRoot = path.join(tmp, "artifacts");
  let run = await createMigrationRun({
    sourceRoot: "A private dashboard for invoices and approval workflows",
    inputKind: "description",
    outputRoot,
    artifactRoot,
  });
  run = await approveMigrationRun(run);
  const ir = createSkeletonProjectIR({
    sourceRoot: run.sourceRoot,
    inputKind: run.inputKind,
    inputDescription: run.inputDescription,
  });
  const context = migrationContext(run, ir, []);
  return { tmp, outputRoot, artifactRoot, context };
}

describe("scaffoldAgentNativeTarget", () => {
  it("rejects writes when the run has not been approved", async () => {
    const tmp = await fs.mkdtemp(
      path.join(os.tmpdir(), "an-migrate-target-unapproved-"),
    );
    const outputRoot = path.join(tmp, "migrated-app");
    const artifactRoot = path.join(tmp, "artifacts");
    const run = await createMigrationRun({
      sourceRoot: "A private dashboard for invoices",
      inputKind: "description",
      outputRoot,
      artifactRoot,
    });
    expect(run.approved).toBe(false);
    const ir = createSkeletonProjectIR({
      sourceRoot: run.sourceRoot,
      inputKind: run.inputKind,
      inputDescription: run.inputDescription,
    });
    const context = migrationContext(run, ir, []);

    const result = await scaffoldAgentNativeTarget(context);

    expect(result).toEqual({
      ok: false,
      summary: "Migration output writes require plan approval first.",
      changedFiles: [],
      artifactPaths: [],
    });
    await expect(fs.stat(outputRoot)).rejects.toThrow();
  });

  it("writes correct file contents and a manifest matching changedFiles", async () => {
    const { outputRoot, context } = await createApprovedContext(
      "an-migrate-target-happy-",
    );

    const result = await scaffoldAgentNativeTarget(context);

    expect(result.ok).toBe(true);
    expect(result.summary).toBe(
      `Scaffolded agent-native output with ${result.changedFiles.length} files.`,
    );

    const packageJson = JSON.parse(
      await fs.readFile(path.join(outputRoot, "package.json"), "utf-8"),
    );
    expect(packageJson.name).toBe("migrated-agent-native-app");
    expect(packageJson.private).toBe(true);
    expect(packageJson.scripts.dev).toBe("agent-native dev --open");

    const navigateAction = await fs.readFile(
      path.join(outputRoot, "actions/navigate.ts"),
      "utf-8",
    );
    expect(navigateAction).toContain("writeAppState");
    expect(navigateAction).toContain("defineAction");

    const runAction = await fs.readFile(
      path.join(outputRoot, "actions/run.ts"),
      "utf-8",
    );
    expect(runAction).toBe(
      'import { runScript } from "@agent-native/core/scripts";\nrunScript();\n',
    );

    expect(result.artifactPaths).toEqual([
      path.join(context.artifacts.runDir, "generated-files.json"),
    ]);
    const manifest = JSON.parse(
      await fs.readFile(result.artifactPaths[0]!, "utf-8"),
    );
    expect(manifest).toEqual(result.changedFiles);
  });

  it("maps dynamic and catch-all route paths to sanitized route files", async () => {
    const tmp = await fs.mkdtemp(
      path.join(os.tmpdir(), "an-migrate-target-routes-"),
    );
    const outputRoot = path.join(tmp, "migrated-app");
    const artifactRoot = path.join(tmp, "artifacts");
    let run = await createMigrationRun({
      sourceRoot: "A private dashboard with user profiles and a blog",
      inputKind: "description",
      outputRoot,
      artifactRoot,
    });
    run = await approveMigrationRun(run);

    const routes: SiteRoute[] = [
      {
        id: "root",
        path: "/",
        filePath: "pages/index.tsx",
        router: "unknown",
        kind: "app",
        dynamic: false,
        public: true,
      },
      {
        id: "user-detail",
        path: "/users/:id",
        filePath: "pages/users/[id].tsx",
        router: "unknown",
        kind: "app",
        dynamic: true,
        public: false,
      },
      {
        id: "blog-catchall",
        path: "/blog/*",
        filePath: "pages/blog/[...slug].tsx",
        router: "unknown",
        kind: "app",
        dynamic: true,
        public: true,
      },
    ];
    const ir: ProjectIR = {
      site: {
        framework: "unknown",
        sourceRoot: run.sourceRoot,
        routes,
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
    const context = migrationContext(run, ir, []);

    const result = await scaffoldAgentNativeTarget(context);

    expect(result.ok).toBe(true);
    await expect(
      fs.stat(path.join(outputRoot, "app/routes/users.$id.tsx")),
    ).resolves.toBeTruthy();
    await expect(
      fs.stat(path.join(outputRoot, "app/routes/blog.$.tsx")),
    ).resolves.toBeTruthy();

    expect(
      result.changedFiles.filter((file) => file === "app/routes/_index.tsx"),
    ).toHaveLength(1);
    expect(
      result.changedFiles.filter((file) => file.startsWith("app/routes/")),
    ).toHaveLength(3);
    expect(result.changedFiles).not.toContain("app/routes/.tsx");
  });

  it("safely encodes route paths containing JSX and template-literal-special characters", async () => {
    const tmp = await fs.mkdtemp(
      path.join(os.tmpdir(), "an-migrate-target-escaping-"),
    );
    const outputRoot = path.join(tmp, "migrated-app");
    const artifactRoot = path.join(tmp, "artifacts");
    let run = await createMigrationRun({
      sourceRoot: "A migrated legacy site with unusual route paths",
      inputKind: "description",
      outputRoot,
      artifactRoot,
    });
    run = await approveMigrationRun(run);

    // A route path containing a backtick and a template-literal `${...}`
    // interpolation sequence, and one containing JSX-significant characters.
    // generatedRoute() must JSON.stringify() these before interpolating them
    // into JSX-expression braces so they can't break out of the generated
    // file's outer template literal or produce invalid/unsafe TS.
    const weirdPath = "/weird/`${evil}`";
    const jsxSpecialPath = "/a&b<c>d{e}";

    const routes: SiteRoute[] = [
      {
        id: "weird",
        path: weirdPath,
        filePath: "pages/weird.tsx",
        router: "unknown",
        kind: "app",
        dynamic: false,
        public: true,
      },
      {
        id: "jsx-special",
        path: jsxSpecialPath,
        filePath: "pages/jsx-special.tsx",
        router: "unknown",
        kind: "app",
        dynamic: false,
        public: true,
      },
    ];
    const ir: ProjectIR = {
      site: {
        framework: "unknown",
        sourceRoot: run.sourceRoot,
        routes,
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
    const context = migrationContext(run, ir, []);

    const result = await scaffoldAgentNativeTarget(context);
    expect(result.ok).toBe(true);

    // File names mirror the same routeToFile() transformation covered by
    // the route-naming test above: strip the leading slash, turn `:`/`*`
    // into `$`, and turn `/` into `.`.
    const weirdRouteFile = path.join(
      outputRoot,
      "app/routes/weird.`${evil}`.tsx",
    );
    const jsxSpecialRouteFile = path.join(
      outputRoot,
      "app/routes/a&b<c>d{e}.tsx",
    );

    const weirdContent = await fs.readFile(weirdRouteFile, "utf-8");
    expect(weirdContent).toContain("export default function MigratedRoute");
    // The route path must appear as its JSON.stringify()'d form...
    expect(weirdContent).toContain(JSON.stringify(weirdPath));
    // ...never as a raw, unquoted interpolation, which is exactly the
    // pattern that would prematurely terminate the outer template literal
    // or otherwise corrupt the generated file.
    expect(weirdContent.includes(`{${weirdPath}}`)).toBe(false);

    const jsxSpecialContent = await fs.readFile(jsxSpecialRouteFile, "utf-8");
    expect(jsxSpecialContent).toContain(
      "export default function MigratedRoute",
    );
    expect(jsxSpecialContent).toContain(JSON.stringify(jsxSpecialPath));
    expect(jsxSpecialContent.includes(`{${jsxSpecialPath}}`)).toBe(false);
  });
});

describe("verifyAgentNativeConformance", () => {
  it("reports missing required files when the output directory was never scaffolded", async () => {
    const tmp = await fs.mkdtemp(
      path.join(os.tmpdir(), "an-migrate-target-verify-missing-"),
    );
    const outputRoot = path.join(tmp, "migrated-app");
    const artifactRoot = path.join(tmp, "artifacts");
    const run = await createMigrationRun({
      sourceRoot: "A private dashboard for invoices",
      inputKind: "description",
      outputRoot,
      artifactRoot,
    });
    const ir = createSkeletonProjectIR({
      sourceRoot: run.sourceRoot,
      inputKind: run.inputKind,
      inputDescription: run.inputDescription,
    });
    const context = migrationContext(run, ir, []);

    const result = await verifyAgentNativeConformance(context);

    expect(result.ok).toBe(false);
    expect(result.severity).toBe("error");
    expect(result.summary).toContain(
      "Generated output is missing required files",
    );
    for (const file of REQUIRED_CONFORMANCE_FILES) {
      expect(result.summary).toContain(file);
    }
    expect(result.suggestedNextTask).toBeDefined();
  });

  it("passes once a full scaffold has produced all required files", async () => {
    const { context } = await createApprovedContext(
      "an-migrate-target-verify-pass-",
    );
    const scaffoldResult = await scaffoldAgentNativeTarget(context);
    expect(scaffoldResult.ok).toBe(true);

    const result = await verifyAgentNativeConformance(context);

    expect(result.ok).toBe(true);
    expect(result.severity).toBe("info");
    expect(result.suggestedNextTask).toBeUndefined();
  });
});

describe("agentNativeTargetAdapter.verify (output-files verifier)", () => {
  it("reports the output directory as missing when it was never created", async () => {
    const tmp = await fs.mkdtemp(
      path.join(os.tmpdir(), "an-migrate-target-verify-outputdir-missing-"),
    );
    const outputRoot = path.join(tmp, "migrated-app");
    const artifactRoot = path.join(tmp, "artifacts");
    const run = await createMigrationRun({
      sourceRoot: "A private dashboard for invoices",
      inputKind: "description",
      outputRoot,
      artifactRoot,
    });
    const ir = createSkeletonProjectIR({
      sourceRoot: run.sourceRoot,
      inputKind: run.inputKind,
      inputDescription: run.inputDescription,
    });
    const context = migrationContext(run, ir, []);

    const results = await agentNativeTargetAdapter.verify!(context);

    expect(results[1]!.ok).toBe(false);
    expect(results[1]!.severity).toBe("error");
    expect(results[1]!.summary).toContain("does not exist");
    expect(results[1]!.suggestedNextTask).toBeDefined();
  });

  it("reports the output directory as existing after a scaffold", async () => {
    const { context } = await createApprovedContext(
      "an-migrate-target-verify-outputdir-exists-",
    );
    await scaffoldAgentNativeTarget(context);

    const results = await agentNativeTargetAdapter.verify!(context);

    expect(results[1]!.ok).toBe(true);
    expect(results[1]!.summary).toContain("exists");
  });
});
