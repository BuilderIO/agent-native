import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { AN_SKILL_MD } from "../cli/skills-content/an-skill.js";
import { ASSETS_SKILL_MD } from "../cli/skills-content/assets-skill.js";
import { CONTENT_SKILL_MD } from "../cli/skills-content/content-skill.js";
import {
  buildSkill,
  createMcpSkillCatalog,
  filterAuthorizedMcpSkills,
  getBuiltinMcpSkill,
  getMcpSkill,
  isValidSkillUri,
  listMcpSkills,
  MCP_SKILLS_EXTENSION_ID,
  readMcpSkillFile,
  resolveConfiguredMcpSkills,
  validateSkillReferencePath,
} from "./skills-extension.js";

const sha = (text: string) =>
  `sha256:${createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex")}`;

const exportedDemoMd = `---
name: demo
description: Demo skill for testing MCP export
metadata:
  visibility: exported
---
# Demo
`;

describe("skills-extension", () => {
  it("uses the SEP-2640 extension id", () => {
    expect(MCP_SKILLS_EXTENSION_ID).toBe("io.modelcontextprotocol/skills");
  });

  it("lists the an skill with its frontmatter and a digest of the served bytes", () => {
    const listed = listMcpSkills();
    expect(listed).toEqual({
      resultType: "complete",
      ttlMs: 0,
      cacheScope: "private",
      skills: [
        {
          uri: "skill://an/SKILL.md",
          frontmatter: expect.objectContaining({ name: "an" }),
          resources: [
            {
              uri: "skill://an/SKILL.md",
              digest: sha(AN_SKILL_MD),
              size: Buffer.byteLength(AN_SKILL_MD, "utf8"),
            },
          ],
        },
      ],
    });
    expect(typeof listed.skills[0]?.frontmatter.description).toBe("string");
  });

  it("gets the skill only by its exact uri", () => {
    expect(getMcpSkill("skill://an/SKILL.md")).toEqual({
      resultType: "complete",
      ttlMs: 0,
      cacheScope: "private",
      skill: listMcpSkills().skills[0],
    });
    expect(getMcpSkill("skill://an")).toBeNull();
    expect(getMcpSkill("skill://other/SKILL.md")).toBeNull();
    expect(getMcpSkill(undefined)).toBeNull();
  });

  it("reads SKILL.md and nothing else", () => {
    expect(readMcpSkillFile("skill://an/SKILL.md")).toEqual({
      contents: [
        {
          uri: "skill://an/SKILL.md",
          mimeType: "text/markdown",
          text: AN_SKILL_MD,
        },
      ],
    });
    expect(readMcpSkillFile("skill://an/references/x.md")).toBeNull();
    expect(readMcpSkillFile(42)).toBeNull();
  });

  it("builds from CRLF frontmatter and counts multi-byte text in bytes", () => {
    const md =
      "---\r\nname: demo\r\ndescription: Café views\r\n---\r\n# Démo\r\n";
    const { entry, files } = buildSkill("demo", md);
    expect(entry.frontmatter).toEqual({
      name: "demo",
      description: "Café views",
    });
    expect(entry.resources[0]).toEqual({
      uri: "skill://demo/SKILL.md",
      digest: sha(md),
      size: Buffer.byteLength(md, "utf8"),
    });
    expect(entry.resources[0]?.size).toBeGreaterThan(md.length);
    expect(files).toEqual([
      { uri: "skill://demo/SKILL.md", text: md, mimeType: "text/markdown" },
    ]);
  });

  it("builds a skill with supporting references and computes digests and sizes for every file", () => {
    const guideMd = "# Guide — résumé\n";
    const schemaJson = '{"version":1}\n';
    const built = buildSkill("demo", exportedDemoMd, {
      requireExportedVisibility: true,
      references: {
        "references/schema.json": schemaJson,
        "references/guide.md": guideMd,
      },
    });
    expect(built.entry.resources).toEqual([
      {
        uri: "skill://demo/SKILL.md",
        digest: sha(exportedDemoMd),
        size: Buffer.byteLength(exportedDemoMd, "utf8"),
      },
      {
        uri: "skill://demo/references/guide.md",
        digest: sha(guideMd),
        size: Buffer.byteLength(guideMd, "utf8"),
      },
      {
        uri: "skill://demo/references/schema.json",
        digest: sha(schemaJson),
        size: Buffer.byteLength(schemaJson, "utf8"),
      },
    ]);

    const catalog = createMcpSkillCatalog([built]);
    expect(catalog.readFile("skill://demo/references/guide.md")).toEqual({
      contents: [
        {
          uri: "skill://demo/references/guide.md",
          mimeType: "text/markdown",
          text: guideMd,
        },
      ],
    });
    expect(catalog.readFile("skill://demo/references/schema.json")).toEqual({
      contents: [
        {
          uri: "skill://demo/references/schema.json",
          mimeType: "application/json",
          text: schemaJson,
        },
      ],
    });
  });

  it.each([
    ["no frontmatter", "# Just a heading\n"],
    ["unterminated frontmatter", "---\nname: demo\ndescription: d\n"],
    [
      "frontmatter not at the start",
      "intro\n---\nname: demo\ndescription: d\n---\n",
    ],
    ["a scalar frontmatter", "---\njust text\n---\n"],
    ["empty frontmatter", "---\n\n---\n"],
    ["another name", "---\nname: other\ndescription: d\n---\n"],
    ["no description", "---\nname: demo\n---\n"],
    ["blank description", "---\nname: demo\ndescription: '   '\n---\n"],
    ["a non-string description", "---\nname: demo\ndescription: 3\n---\n"],
  ])("rejects %s", (_label, md) => {
    expect(() => buildSkill("demo", md)).toThrow(
      "Skill demo needs frontmatter with its name and description",
    );
  });

  it("rejects internal, dev-scoped, non-invocable, and unexported skills", () => {
    expect(() =>
      buildSkill(
        "demo",
        "---\nname: demo\ndescription: Internal\nmetadata:\n  internal: true\n---\n# Body\n",
      ),
    ).toThrow(/marked internal/);

    expect(() =>
      buildSkill(
        "demo",
        "---\nname: demo\ndescription: Dev only\nscope: dev\nmetadata:\n  visibility: exported\n---\n# Body\n",
      ),
    ).toThrow(/non-exported scope/);

    expect(() =>
      buildSkill(
        "demo",
        "---\nname: demo\ndescription: Hidden\nuser-invocable: false\nmetadata:\n  visibility: exported\n---\n# Body\n",
      ),
    ).toThrow(/not user-invocable/);

    expect(() =>
      buildSkill(
        "demo",
        "---\nname: demo\ndescription: Private\nmetadata:\n  visibility: private\n---\n# Body\n",
      ),
    ).toThrow(/visibility "private"/);

    expect(() =>
      buildSkill(
        "demo",
        "---\nname: demo\ndescription: No export flag\n---\n",
        {
          requireExportedVisibility: true,
        },
      ),
    ).toThrow(/metadata\.visibility: exported/);
  });

  it.each([
    "../etc/passwd",
    "references/../SKILL.md",
    "references/../../secrets.md",
    "references/.env",
    "references/.agents/skills/internal/SKILL.md",
    ".agents/skills/actions/SKILL.md",
    "memory/MEMORY.md",
    "/references/abs.md",
    "references\\win.md",
    "references/%2e%2e/escape.md",
    "references/query.md?foo=bar",
    "references/frag.md#top",
    "references/a/b/c/d/e/f/too-deep.md",
  ])("rejects unsafe reference path %s", (badPath) => {
    expect(() => validateSkillReferencePath("demo", badPath)).toThrow(
      /Invalid reference path/,
    );
    expect(() =>
      buildSkill("demo", exportedDemoMd, {
        references: { [badPath]: "nope" },
      }),
    ).toThrow(/Invalid reference path/);
  });

  it.each(["../escape", ".agents", "memory/a", "BadCaps", ""])(
    "rejects unsafe skill name %s",
    (badName) => {
      expect(() => buildSkill(badName, exportedDemoMd)).toThrow(
        /Invalid MCP skill name/,
      );
    },
  );

  it("validates skill URIs strictly", () => {
    expect(isValidSkillUri("skill://assets/SKILL.md")).toBe(true);
    expect(isValidSkillUri("skill://demo/references/guide.md")).toBe(true);
    expect(isValidSkillUri("skill://demo/references/nested/guide.md")).toBe(
      true,
    );
    expect(isValidSkillUri("skill://demo/../secret.md")).toBe(false);
    expect(isValidSkillUri("skill://demo/references/../SKILL.md")).toBe(false);
    expect(isValidSkillUri("skill://demo/.agents/skills/a/SKILL.md")).toBe(
      false,
    );
    expect(isValidSkillUri("skill://demo/memory/MEMORY.md")).toBe(false);
    expect(isValidSkillUri("skill://demo/SKILL.md?x=1")).toBe(false);
    expect(isValidSkillUri("file:///etc/passwd")).toBe(false);
  });

  it("resolves built-in reviewed skills and combines servesAnSkill with explicit skills", () => {
    expect(getBuiltinMcpSkill("assets").entry.uri).toBe(
      "skill://assets/SKILL.md",
    );
    expect(getBuiltinMcpSkill("assets").files[0]?.text).toBe(ASSETS_SKILL_MD);
    expect(getBuiltinMcpSkill("content").entry.uri).toBe(
      "skill://content/SKILL.md",
    );
    expect(getBuiltinMcpSkill("content").files[0]?.text).toBe(CONTENT_SKILL_MD);

    const combined = resolveConfiguredMcpSkills({
      servesAnSkill: true,
      skills: ["assets", { name: "demo", skillMd: exportedDemoMd }],
    });
    expect(combined.map((skill) => skill.name)).toEqual([
      "an",
      "assets",
      "demo",
    ]);

    expect(() =>
      resolveConfiguredMcpSkills({
        skills: ["assets", "assets"],
      }),
    ).toThrow(/Duplicate MCP skill configured/);
  });

  it("filters skills consistently by orgIds, requiresLab, and custom authorize", async () => {
    const orgASkill = buildSkill("demo", exportedDemoMd, {
      requireExportedVisibility: true,
      orgIds: ["org-a"],
    });
    const labSkill = buildSkill(
      "lab-demo",
      `---\nname: lab-demo\ndescription: Lab skill\nrequires-lab: demo.preview\nmetadata:\n  visibility: exported\n---\n# Lab\n`,
      { requireExportedVisibility: true },
    );
    const customAuthSkill = buildSkill(
      "custom-demo",
      `---\nname: custom-demo\ndescription: Custom auth\nmetadata:\n  visibility: exported\n---\n# Custom\n`,
      {
        requireExportedVisibility: true,
        authorize: (ctx) => ctx.userEmail === "alice@example.com",
      },
    );
    const all = [orgASkill, labSkill, customAuthSkill];

    const aliceOrgA = await filterAuthorizedMcpSkills(
      all,
      { userEmail: "alice@example.com", orgId: "org-a" },
      { checkLab: async (lab) => lab === "demo.preview" },
    );
    expect(aliceOrgA.map((s) => s.name)).toEqual([
      "demo",
      "lab-demo",
      "custom-demo",
    ]);

    const bobOrgB = await filterAuthorizedMcpSkills(
      all,
      { userEmail: "bob@example.com", orgId: "org-b" },
      { checkLab: async () => false },
    );
    expect(bobOrgB).toEqual([]);

    const alicePersonal = await filterAuthorizedMcpSkills(
      all,
      { userEmail: "alice@example.com", orgId: null },
      { checkLab: async () => false },
    );
    expect(alicePersonal.map((s) => s.name)).toEqual(["custom-demo"]);
  });
});
