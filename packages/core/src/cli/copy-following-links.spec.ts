import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { copyFollowingLinks } from "./copy-following-links.js";

const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function tmpDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-copy-links-"));
  tmpRoots.push(root);
  return root;
}

// Windows junctions need no extra rights to make.
function linkDir(target: string, linkPath: string): void {
  fs.symlinkSync(
    target,
    linkPath,
    process.platform === "win32" ? "junction" : "dir",
  );
}

function writeSkill(root: string): string {
  const skill = path.join(root, "skills", "actions");
  fs.mkdirSync(skill, { recursive: true });
  fs.writeFileSync(path.join(skill, "SKILL.md"), "# Actions\n");
  return skill;
}

describe("copyFollowingLinks", () => {
  it("copies a linked folder inside the copy as files", () => {
    const root = tmpDir();
    const skill = writeSkill(root);
    const shared = path.join(root, "shared");
    fs.mkdirSync(shared);
    fs.writeFileSync(path.join(shared, "notes.md"), "Notes\n");
    linkDir(shared, path.join(skill, "references"));

    const out = path.join(root, "out");
    copyFollowingLinks(skill, out);

    const references = path.join(out, "references");
    expect(fs.lstatSync(references).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(path.join(references, "notes.md"), "utf8")).toBe(
      "Notes\n",
    );
  });

  it("leaves out a link that no longer resolves", () => {
    const root = tmpDir();
    const skill = writeSkill(root);
    const gone = path.join(root, "gone");
    fs.mkdirSync(gone);
    linkDir(gone, path.join(skill, "gone"));
    fs.rmSync(gone, { recursive: true });

    const out = path.join(root, "out");
    copyFollowingLinks(skill, out);

    expect(fs.existsSync(path.join(out, "SKILL.md"))).toBe(true);
    expect(
      fs.lstatSync(path.join(out, "gone"), { throwIfNoEntry: false }),
    ).toBeUndefined();
  });

  it("leaves out a link outside `within` or through a skipped name", () => {
    const root = tmpDir();
    const workspace = path.join(root, "workspace");
    const skill = writeSkill(workspace);
    const outside = path.join(root, "outside");
    const privateDir = path.join(workspace, "private", "notes");
    const shared = path.join(workspace, "shared");
    fs.mkdirSync(outside);
    fs.mkdirSync(privateDir, { recursive: true });
    fs.mkdirSync(shared);
    linkDir(outside, path.join(skill, "outside"));
    linkDir(privateDir, path.join(skill, "notes"));
    linkDir(shared, path.join(skill, "shared"));

    const out = path.join(root, "out");
    copyFollowingLinks(skill, out, {
      within: [workspace],
      skip: (name) => name === "private",
    });

    expect(fs.existsSync(path.join(out, "outside"))).toBe(false);
    expect(fs.existsSync(path.join(out, "notes"))).toBe(false);
    expect(fs.statSync(path.join(out, "shared")).isDirectory()).toBe(true);
  });

  it("leaves out links that lead back to a folder the copy is inside", () => {
    const root = tmpDir();
    const skill = writeSkill(root);
    fs.mkdirSync(path.join(skill, "a"));
    fs.mkdirSync(path.join(skill, "b"));
    linkDir(path.join(root, "skills"), path.join(skill, "parent"));
    linkDir(path.join(skill, "b"), path.join(skill, "a", "to-b"));
    linkDir(path.join(skill, "a"), path.join(skill, "b", "to-a"));

    const out = path.join(root, "out");
    copyFollowingLinks(skill, out);

    expect(fs.existsSync(path.join(out, "parent"))).toBe(false);
    expect(fs.statSync(path.join(out, "a", "to-b")).isDirectory()).toBe(true);
    expect(fs.existsSync(path.join(out, "a", "to-b", "to-a"))).toBe(false);
    expect(fs.statSync(path.join(out, "b", "to-a")).isDirectory()).toBe(true);
    expect(fs.existsSync(path.join(out, "b", "to-a", "to-b"))).toBe(false);
  });
});
