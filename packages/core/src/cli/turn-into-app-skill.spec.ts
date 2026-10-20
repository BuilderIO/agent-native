import { describe, expect, it } from "vitest";

import { BUILT_IN_APP_SKILLS } from "./skills.js";

const entry = BUILT_IN_APP_SKILLS["turn-into-app"];
const skillMd = entry.skillMarkdown;
const references = Object.fromEntries(
  Object.entries(entry.extraFiles?.["turn-into-app"] ?? {}).filter(([path]) =>
    path.startsWith("references/"),
  ),
);
const allFiles = { "SKILL.md": skillMd, ...references };

const BANNED_PHRASES = [
  "one primary action",
  "smallest useful surface",
  "simple buttons",
  "later workflow steps",
  "step 1 of",
  "online host",
];

describe("turn-into-app skill structure", () => {
  it("keeps a trigger-rich description under the listing cap", () => {
    const description = /^description:\s*>-\n((?:  .*\n)+)/m
      .exec(skillMd)?.[1]
      .replace(/\n\s*/g, " ")
      .trim();
    expect(description).toBeDefined();
    expect(description!.length).toBeLessThanOrEqual(1024);
    expect(description).toContain("Use when");
    expect(description).not.toMatch(/[<>]/);
  });

  it("stays lean so design guidance lives in references", () => {
    expect(skillMd.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(
      2500,
    );
    expect(skillMd.split("\n").length).toBeLessThanOrEqual(320);
  });

  it("does not reintroduce the instructions that produced stepper forms", () => {
    for (const [file, text] of Object.entries(allFiles)) {
      for (const phrase of BANNED_PHRASES) {
        expect(text.toLowerCase(), `${file}: "${phrase}"`).not.toContain(
          phrase,
        );
      }
    }
  });

  it("links every reference from SKILL.md and resolves every link", () => {
    const linked = [...skillMd.matchAll(/\]\((references\/[^)#\s]+)\)/g)].map(
      (m) => m[1],
    );
    for (const target of linked) {
      expect(Object.keys(references), `SKILL.md -> ${target}`).toContain(
        target,
      );
    }
    for (const file of Object.keys(references)) {
      expect(linked, `${file} is not linked from SKILL.md`).toContain(file);
    }
    for (const [file, text] of Object.entries(references)) {
      for (const m of text.matchAll(/\]\(([^)#\s]+\.md)\)/g)) {
        expect(Object.keys(references), `${file} -> ${m[1]}`).toContain(
          `references/${m[1].replace(/^\.\//, "")}`,
        );
      }
    }
  });

  it("gives long references a contents list and no dead relative doc links", () => {
    for (const [file, text] of Object.entries(references)) {
      if (text.split("\n").length > 100) {
        const firstSection = /^## (.+)$/m.exec(text)?.[1];
        expect(firstSection, `${file} needs ## Contents first`).toBe(
          "Contents",
        );
      }
    }
    for (const [file, text] of Object.entries(allFiles)) {
      expect(text, `${file} links a relative /docs path`).not.toMatch(
        /\]\(\/docs\//,
      );
    }
  });
});
