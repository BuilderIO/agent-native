import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  listCodeAgentRunRecords,
  listCodeAgentTranscriptEvents,
} from "./code-agent-runs.js";
import {
  emitOwnAgentDossier,
  isExpectedMigrationCliError,
  parseMigrateArgs,
  runMigrate,
} from "./migrate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoots: string[] = [];

afterEach(() => {
  delete process.env.AGENT_NATIVE_CODE_AGENTS_HOME;
  vi.restoreAllMocks();
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("parseMigrateArgs", () => {
  it("parses source and output defaults", () => {
    expect(parseMigrateArgs(["./next-app"])).toEqual({
      source: "./next-app",
    });
  });

  it("parses named options", () => {
    expect(
      parseMigrateArgs([
        "./next-app",
        "--out",
        "../out",
        "--name=migration-lab",
        "--target",
        "agent-native",
        "--plan-only",
        "--plan-file",
        "aem-plan.md",
      ]),
    ).toEqual({
      source: "./next-app",
      output: "../out",
      appName: "migration-lab",
      target: "agent-native",
      planOnly: true,
      planFile: "aem-plan.md",
    });
  });

  it("parses subcommands and any-input source options", () => {
    expect(parseMigrateArgs(["status", "./migration"])).toEqual({
      subcommand: "status",
      workbench: "./migration",
    });
    expect(parseMigrateArgs(["resume", "--last"])).toEqual({
      subcommand: "resume",
      last: true,
    });

    expect(
      parseMigrateArgs([
        "--url",
        "https://example.com",
        "--describe",
        "marketing site",
        "--emit",
        "../dossier",
      ]),
    ).toEqual({
      sourceUrl: "https://example.com",
      sourceDescription: "marketing site",
      emit: true,
      emitDir: "../dossier",
    });
    expect(parseMigrateArgs(["./next-app", "--app-surface"])).toEqual({
      source: "./next-app",
      appSurface: true,
    });
  });

  it("creates a generic Agent-Native Code session by default", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-migrate-"));
    tmpRoots.push(root);
    process.env.AGENT_NATIVE_CODE_AGENTS_HOME = path.join(root, "code-agents");
    const sourceRoot = path.join(root, "source");
    fs.mkdirSync(path.join(sourceRoot, "pages"), { recursive: true });
    fs.writeFileSync(
      path.join(sourceRoot, "package.json"),
      JSON.stringify({ dependencies: { next: "^16.0.0" } }),
    );
    fs.writeFileSync(
      path.join(sourceRoot, "pages", "index.tsx"),
      "export default function Home() { return <main />; }\n",
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await runMigrate([sourceRoot, "--out", path.join(root, "migrated")]);

    const runs = listCodeAgentRunRecords("migrate");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      goalId: "migrate",
      status: "needs-approval",
      phase: "intake",
      progress: {
        label: "Dossier ready; waiting for approval",
        completed: 1,
        total: 2,
        percent: 50,
      },
    });
    const dossierRoot = runs[0].metadata?.dossierRoot;
    expect(typeof dossierRoot).toBe("string");
    expect(runs[0].metadata).toMatchObject({
      preferredCommand: "agent-native code /migrate",
      resumeCommand: "agent-native code resume --last",
      attachCommand: "agent-native code attach --last",
      statusCommand: "agent-native code status --last",
    });
    expect(fs.existsSync(path.join(String(dossierRoot), "AGENTS.md"))).toBe(
      true,
    );
    expect(
      fs.existsSync(path.join(String(dossierRoot), "MIGRATION_PLAYBOOK.md")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(String(dossierRoot), "01-assessment.md")),
    ).toBe(true);
    expect(fs.existsSync(path.join(String(dossierRoot), "ir.json"))).toBe(true);
    expect(fs.existsSync(path.join(root, "migration"))).toBe(false);
    expect(
      listCodeAgentTranscriptEvents(runs[0].id).map((event) => event.kind),
    ).toEqual(["user", "status", "artifact", "note", "status"]);
    expect(log.mock.calls.join("\n")).toContain(
      "Agent-Native Code /migrate session created.",
    );
    expect(log.mock.calls.join("\n")).toContain("Artifacts:");
    expect(log.mock.calls.join("\n")).toContain(
      "agent-native code attach --last",
    );
    expect(log.mock.calls.join("\n")).toContain(
      "Migration stays in Agent-Native Code. No hidden app/template was scaffolded.",
    );
  });

  it("dogfoods a real Next.js fixture into a slash-command migration dossier", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-migrate-fixture-"));
    tmpRoots.push(root);
    process.env.AGENT_NATIVE_CODE_AGENTS_HOME = path.join(root, "code-agents");
    const sourceRoot = path.resolve(
      __dirname,
      "../../../migrate/src/__fixtures__/next-pages",
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await runMigrate([sourceRoot, "--out", path.join(root, "migrated")]);

    const [run] = listCodeAgentRunRecords("migrate");
    expect(typeof run?.metadata?.usedMigrateHelpers).toBe("boolean");
    const dossierRoot = String(run?.metadata?.dossierRoot);
    const assessment = fs.readFileSync(
      path.join(dossierRoot, "01-assessment.md"),
      "utf-8",
    );
    const ir = JSON.parse(
      fs.readFileSync(path.join(dossierRoot, "ir.json"), "utf-8"),
    );

    expect(assessment).toContain("Framework: nextjs");
    expect(ir.site.routes.map((route: { path: string }) => route.path)).toEqual(
      expect.arrayContaining(["/", "/dashboard"]),
    );
    expect(ir.behavior.apiEndpoints[0]).toMatchObject({
      path: "/api/hello",
      recommendedRecipe: "api-routes-to-actions",
    });
    expect(fs.existsSync(path.join(root, "migration"))).toBe(false);
    expect(log.mock.calls.join("\n")).toContain("Goal:    /migrate");
  });

  it("emits a dossier outside sourceRoot", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-migrate-"));
    tmpRoots.push(root);
    const sourceRoot = path.join(root, "source");
    const dossierRoot = path.join(root, "dossier");
    fs.mkdirSync(path.join(sourceRoot, "pages"), { recursive: true });
    fs.writeFileSync(
      path.join(sourceRoot, "package.json"),
      JSON.stringify({ dependencies: { next: "^16.0.0" } }),
    );
    fs.writeFileSync(
      path.join(sourceRoot, "pages", "index.tsx"),
      "export default function Home() { return <main />; }\n",
    );

    const result = await emitOwnAgentDossier(
      { source: sourceRoot, emit: true, emitDir: dossierRoot },
      root,
    );

    expect(result.dossierRoot).toBe(dossierRoot);
    expect(result.files).toEqual(
      expect.arrayContaining([
        "AGENTS.md",
        "MIGRATION_PLAYBOOK.md",
        "01-assessment.md",
        "ir.json",
        "source.json",
      ]),
    );
    expect(fs.existsSync(path.join(dossierRoot, "AGENTS.md"))).toBe(true);
    expect(fs.existsSync(path.join(dossierRoot, "MIGRATION_PLAYBOOK.md"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(dossierRoot, "01-assessment.md"))).toBe(
      true,
    );
    const agentsMd = fs.readFileSync(
      path.join(dossierRoot, "AGENTS.md"),
      "utf-8",
    );
    const playbook = fs.readFileSync(
      path.join(dossierRoot, "MIGRATION_PLAYBOOK.md"),
      "utf-8",
    );
    const ir = JSON.parse(
      fs.readFileSync(path.join(dossierRoot, "ir.json"), "utf-8"),
    );

    expect(agentsMd).toContain("Treat source as read-only");
    expect(playbook).toContain("Use With Agent-Native Code Or Desktop");
    expect(ir).toMatchObject({
      site: { framework: "nextjs" },
    });
    expect(fs.existsSync(path.join(sourceRoot, "AGENTS.md"))).toBe(false);
  });

  it("emits custom migration plan inputs into the dossier", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-migrate-plan-"));
    tmpRoots.push(root);
    const sourceRoot = path.join(root, "source");
    const dossierRoot = path.join(root, "dossier");
    const planFile = path.join(root, "aem-plan.md");
    fs.mkdirSync(path.join(sourceRoot, "pages"), { recursive: true });
    fs.writeFileSync(
      path.join(sourceRoot, "package.json"),
      JSON.stringify({ dependencies: { next: "^16.0.0" } }),
    );
    fs.writeFileSync(
      path.join(sourceRoot, "pages", "index.tsx"),
      "export default function Home() { return <main />; }\n",
    );
    fs.writeFileSync(
      planFile,
      [
        "# AEM migration plan",
        "Static/low-change pages go to Builder.",
        "Dynamic pages go to Akeneo headless.",
        "Fragments use jQuery clientlibs that should be rewritten.",
      ].join("\n"),
    );

    const result = await emitOwnAgentDossier(
      {
        source: sourceRoot,
        emit: true,
        emitDir: dossierRoot,
        planFile,
      },
      root,
    );

    expect(result.files).toContain("02-plan-inputs.json");
    const planInputs = JSON.parse(
      fs.readFileSync(path.join(dossierRoot, "02-plan-inputs.json"), "utf-8"),
    );
    expect(planInputs).toMatchObject({
      builder: { enabled: true },
      headless: { provider: "Akeneo" },
      jquery: { policy: "rewrite" },
    });
    expect(
      fs.readFileSync(path.join(dossierRoot, "MIGRATION_PLAYBOOK.md"), "utf-8"),
    ).toContain("Use `02-plan-inputs.json`");
  });

  it("does not treat unsupported JSON plan files as binding plan inputs", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-migrate-plan-"));
    tmpRoots.push(root);
    const sourceRoot = path.join(root, "source");
    const dossierRoot = path.join(root, "dossier");
    const planFile = path.join(root, "empty-plan.json");
    fs.mkdirSync(path.join(sourceRoot, "pages"), { recursive: true });
    fs.writeFileSync(
      path.join(sourceRoot, "package.json"),
      JSON.stringify({ dependencies: { next: "^16.0.0" } }),
    );
    fs.writeFileSync(
      path.join(sourceRoot, "pages", "index.tsx"),
      "export default function Home() { return <main />; }\n",
    );
    fs.writeFileSync(planFile, "[]");

    const result = await emitOwnAgentDossier(
      {
        source: sourceRoot,
        emit: true,
        emitDir: dossierRoot,
        planFile,
      },
      root,
    );

    expect(result.files).not.toContain("02-plan-inputs.json");
    expect(
      fs.readFileSync(path.join(dossierRoot, "MIGRATION_PLAYBOOK.md"), "utf-8"),
    ).not.toContain("Use `02-plan-inputs.json`");
  });

  it("refuses explicit emit paths inside sourceRoot", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-migrate-"));
    tmpRoots.push(root);
    const sourceRoot = path.join(root, "source");
    fs.mkdirSync(sourceRoot, { recursive: true });

    await expect(
      emitOwnAgentDossier(
        {
          source: sourceRoot,
          emit: true,
          emitDir: path.join(sourceRoot, "dossier"),
        },
        root,
      ),
    ).rejects.toThrow(/Refusing to emit dossier inside sourceRoot/);
  });

  it("classifies expected emit validation failures as user-facing CLI errors", () => {
    expect(
      isExpectedMigrationCliError(
        new Error(
          "Refusing to emit dossier inside sourceRoot (/tmp/source). Choose an --emit path outside the source project.",
        ),
      ),
    ).toBe(true);
    expect(
      isExpectedMigrationCliError(
        new Error("Usage: agent-native migrate <source> --emit"),
      ),
    ).toBe(true);
    expect(isExpectedMigrationCliError(new Error("disk exploded"))).toBe(false);
  });

  it("status output points empty users at the Agent-Native Code slash command", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-migrate-status-"));
    tmpRoots.push(root);
    process.env.AGENT_NATIVE_CODE_AGENTS_HOME = path.join(root, "code-agents");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await runMigrate(["status", "--last"]);

    const output = log.mock.calls.join("\n");
    expect(output).toContain("No /migrate sessions found.");
    expect(output).toContain("agent-native code /migrate <source>");
    expect(output).toContain("agent-native migrate status --last");
    expect(output).toContain(
      "legacy --app-surface detail app has been removed",
    );
  });
});
