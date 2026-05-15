import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  emitOwnAgentDossier,
  isExpectedMigrationCliError,
  parseMigrateArgs,
} from "./migrate.js";

const tmpRoots: string[] = [];

afterEach(() => {
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
      ]),
    ).toEqual({
      source: "./next-app",
      output: "../out",
      appName: "migration-lab",
      target: "agent-native",
      planOnly: true,
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
        ".agents/skills/migration/SKILL.md",
        ".agents/skills/migration-source-nextjs/SKILL.md",
        ".agents/skills/migration-source-aem/SKILL.md",
        ".agents/skills/migration-target-builder/SKILL.md",
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
    expect(playbook).toContain("Use With Code Agents Or Desktop");
    expect(ir).toMatchObject({
      site: { framework: "nextjs" },
    });
    expect(fs.existsSync(path.join(sourceRoot, "AGENTS.md"))).toBe(false);
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
});
