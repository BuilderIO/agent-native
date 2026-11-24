import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { AN_SKILL_MD } from "../cli/skills-content/an-skill.js";
import {
  buildSkill,
  getMcpSkill,
  listMcpSkills,
  MCP_SKILLS_EXTENSION_ID,
  readMcpSkillFile,
} from "./skills-extension.js";

const sha = (text: string) =>
  `sha256:${createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex")}`;

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
    expect(typeof listed.skills[0]!.frontmatter.description).toBe("string");
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
    expect(entry.resources[0]!.size).toBeGreaterThan(md.length);
    expect(files).toEqual([
      { uri: "skill://demo/SKILL.md", text: md, mimeType: "text/markdown" },
    ]);
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
    ["a non-string description", "---\nname: demo\ndescription: 3\n---\n"],
  ])("rejects %s", (_label, md) => {
    expect(() => buildSkill("demo", md)).toThrow(
      "Skill demo needs frontmatter with its name and description",
    );
  });
});
