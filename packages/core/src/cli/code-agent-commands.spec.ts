import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  findProjectSlashCommand,
  isReservedProjectSlashCommandName,
  listProjectSkills,
  listProjectSlashCommands,
  listVisibleProjectSlashCommands,
  readProjectCodePack,
} from "./code-agent-commands.js";

const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("project code packs", () => {
  it("reads commands and skills as structured metadata", () => {
    const root = createTempProject();
    writeFile(
      root,
      ".agents/commands/release/check.md",
      [
        "---",
        'description: "Run release checks"',
        "argument-hint: <version>",
        "---",
        "Check release $ARGUMENTS.",
      ].join("\n"),
    );
    writeFile(
      root,
      ".agents/skills/release/SKILL.md",
      [
        "---",
        "name: release",
        "description: >-",
        "  Guidance for preparing",
        "  release changes.",
        "---",
        "Use the release checklist.",
      ].join("\n"),
    );

    expect(readProjectCodePack(root)).toMatchObject({
      schemaVersion: 1,
      root,
      commands: [
        {
          kind: "command",
          name: "release:check",
          relativePath: path.join("release", "check.md"),
          description: "Run release checks",
          argumentHint: "<version>",
          reserved: false,
          body: "Check release $ARGUMENTS.",
        },
      ],
      skills: [
        {
          kind: "skill",
          name: "release",
          relativePath: path.join("release", "SKILL.md"),
          description: "Guidance for preparing release changes.",
          body: "Use the release checklist.",
        },
      ],
    });
  });

  it("retains reserved command filtering for visible command lists", () => {
    const root = createTempProject();
    writeFile(root, ".agents/commands/migrate.md", "Do not show.");
    writeFile(root, ".agents/commands/review.md", "Review changes.");

    expect(
      listProjectSlashCommands(root).map((command) => command.name),
    ).toEqual(["migrate", "review"]);
    expect(
      listVisibleProjectSlashCommands(root).map((command) => command.name),
    ).toEqual(["review"]);
    expect(isReservedProjectSlashCommandName("/migrate")).toBe(true);
    expect(
      readProjectCodePack(root).commands.map((command) => command.name),
    ).toEqual(["review"]);
    expect(
      readProjectCodePack(root, { includeReservedCommands: true }).commands.map(
        (command) => command.name,
      ),
    ).toEqual(["migrate", "review"]);
  });

  it("finds reserved project command files for execution lookup", () => {
    const root = createTempProject();
    writeFile(root, ".agents/commands/status.md", "Status shadow.");

    expect(findProjectSlashCommand("/status", root)).toMatchObject({
      name: "status",
      reserved: true,
      body: "Status shadow.",
    });
  });

  it("falls back to directory names for skills without frontmatter names", () => {
    const root = createTempProject();
    writeFile(root, ".agents/skills/review-diff/SKILL.md", "Review diffs.");

    expect(listProjectSkills(root)).toMatchObject([
      {
        name: "review-diff",
        description: undefined,
        scope: "both",
        body: "Review diffs.",
      },
    ]);
  });

  it("lists dev and shared skills for coding agents but skips runtime-only skills", () => {
    const root = createTempProject();
    writeFile(
      root,
      ".agents/skills/dev-only/SKILL.md",
      "---\nname: dev-only\nscope: dev\n---\nDev guidance.",
    );
    writeFile(
      root,
      ".agents/skills/shared/SKILL.md",
      "---\nname: shared\n---\nShared guidance.",
    );
    writeFile(
      root,
      ".agents/skills/runtime-only/SKILL.md",
      "---\nname: runtime-only\nscope: runtime\n---\nRuntime guidance.",
    );

    expect(listProjectSkills(root).map((skill) => skill.name)).toEqual([
      "dev-only",
      "shared",
    ]);
    expect(readProjectCodePack(root).skills).toMatchObject([
      { name: "dev-only", scope: "dev" },
      { name: "shared", scope: "both" },
    ]);
  });

  it("honors CRLF skill frontmatter when filtering runtime-only skills", () => {
    const root = createTempProject();
    writeFile(
      root,
      ".agents/skills/dev-only/SKILL.md",
      "---\r\nname: dev-only\r\nscope: dev\r\n---\r\nDev guidance.",
    );
    writeFile(
      root,
      ".agents/skills/runtime-only/SKILL.md",
      "---\r\nname: runtime-only\r\nscope: runtime\r\n---\r\nRuntime guidance.",
    );

    expect(listProjectSkills(root).map((skill) => skill.name)).toEqual([
      "dev-only",
    ]);
    expect(readProjectCodePack(root).skills).toMatchObject([
      { name: "dev-only", scope: "dev" },
    ]);
  });
});

function createTempProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-code-pack-"));
  tmpRoots.push(root);
  return root;
}

function writeFile(root: string, relativePath: string, contents: string): void {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}
