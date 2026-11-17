import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  copyFollowingLinks,
  replaceFollowingLinks,
} from "./copy-following-links.js";

const tmpRoots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
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

  // oracle-change: a new test, skipped on Windows and as root, where folder permissions can't lock the test out.
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "throws for a link whose target can't be read",
    () => {
      const root = tmpDir();
      const skill = writeSkill(root);
      const locked = path.join(root, "locked");
      fs.mkdirSync(path.join(locked, "notes"), { recursive: true });
      linkDir(path.join(locked, "notes"), path.join(skill, "notes"));
      fs.chmodSync(locked, 0o000);
      try {
        expect(() => copyFollowingLinks(skill, path.join(root, "out"))).toThrow(
          /EACCES/,
        );
      } finally {
        fs.chmodSync(locked, 0o755);
      }
    },
  );

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

  it("leaves out a link to a folder the copy is written into", () => {
    const root = tmpDir();
    const skill = writeSkill(root);
    const installs = path.join(root, "installs");
    fs.mkdirSync(installs);
    linkDir(installs, path.join(skill, "installs"));

    const out = path.join(installs, "actions");
    copyFollowingLinks(skill, out);

    expect(fs.existsSync(path.join(out, "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(out, "installs"))).toBe(false);
  });
});

describe("replaceFollowingLinks", () => {
  function earlierInstall(root: string): string {
    const to = path.join(root, "installs", "actions");
    fs.mkdirSync(to, { recursive: true });
    fs.writeFileSync(path.join(to, "SKILL.md"), "Earlier install\n");
    fs.writeFileSync(path.join(to, "stale.md"), "Stale\n");
    return to;
  }

  it("replaces what was there and leaves nothing beside it", () => {
    const root = tmpDir();
    const skill = writeSkill(root);
    const to = earlierInstall(root);

    replaceFollowingLinks(skill, to);

    expect(fs.readFileSync(path.join(to, "SKILL.md"), "utf8")).toBe(
      "# Actions\n",
    );
    expect(fs.existsSync(path.join(to, "stale.md"))).toBe(false);
    expect(fs.readdirSync(path.dirname(to))).toEqual(["actions"]);
  });

  it("leaves out a link into what it replaces", () => {
    const root = tmpDir();
    const skill = writeSkill(root);
    const to = earlierInstall(root);
    linkDir(to, path.join(skill, "earlier"));

    replaceFollowingLinks(skill, to);

    expect(fs.readFileSync(path.join(to, "SKILL.md"), "utf8")).toBe(
      "# Actions\n",
    );
    expect(fs.existsSync(path.join(to, "earlier"))).toBe(false);
  });

  // oracle-change: a new test, skipped on Windows and as root, where folder permissions can't lock the test out.
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "keeps what was there when the copy fails",
    () => {
      const root = tmpDir();
      const skill = writeSkill(root);
      const locked = path.join(root, "locked");
      fs.mkdirSync(path.join(locked, "notes"), { recursive: true });
      linkDir(path.join(locked, "notes"), path.join(skill, "notes"));
      const to = earlierInstall(root);
      fs.chmodSync(locked, 0o000);
      try {
        expect(() => replaceFollowingLinks(skill, to)).toThrow(/EACCES/);
      } finally {
        fs.chmodSync(locked, 0o755);
      }

      expect(fs.readFileSync(path.join(to, "SKILL.md"), "utf8")).toBe(
        "Earlier install\n",
      );
      expect(fs.readdirSync(path.dirname(to))).toEqual(["actions"]);
    },
  );

  it("puts what was there back when moving the copy in fails", () => {
    const root = tmpDir();
    const skill = writeSkill(root);
    const to = earlierInstall(root);
    const rename = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementation((from, dest) => {
      // Windows refuses the move like this while a file in the folder is open.
      if (path.basename(String(from)) === "copy") {
        throw Object.assign(new Error("EBUSY: resource busy or locked"), {
          code: "EBUSY",
        });
      }
      rename(from, dest);
    });

    expect(() => replaceFollowingLinks(skill, to)).toThrow(/EBUSY/);

    expect(fs.readFileSync(path.join(to, "SKILL.md"), "utf8")).toBe(
      "Earlier install\n",
    );
    expect(fs.readdirSync(path.dirname(to))).toEqual(["actions"]);
  });

  it("keeps what was there, and says where, when it can't be put back", () => {
    const root = tmpDir();
    const skill = writeSkill(root);
    const to = earlierInstall(root);
    const rename = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementation((from, dest) => {
      const name = path.basename(String(from));
      if (name === "copy" || name === "earlier") {
        throw Object.assign(new Error("EBUSY: resource busy or locked"), {
          code: "EBUSY",
        });
      }
      rename(from, dest);
    });

    let message = "";
    try {
      replaceFollowingLinks(skill, to);
    } catch (error) {
      message = (error as Error).message;
    }

    const kept = /it is now at (.+) \(/.exec(message)?.[1];
    expect(kept).toBeDefined();
    expect(fs.readFileSync(path.join(kept!, "SKILL.md"), "utf8")).toBe(
      "Earlier install\n",
    );
  });

  it("refuses to replace a folder the copy comes from", () => {
    const root = tmpDir();
    const skill = writeSkill(root);

    expect(() =>
      replaceFollowingLinks(skill, path.join(root, "skills")),
    ).toThrow(/overlap/);

    expect(fs.readFileSync(path.join(skill, "SKILL.md"), "utf8")).toBe(
      "# Actions\n",
    );
  });
});
