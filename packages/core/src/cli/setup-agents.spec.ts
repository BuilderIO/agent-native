import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  prepareAgentSymlink,
  rebaseAgentSymlinkTarget,
  setupAgentSymlinks,
} from "./setup-agents.js";

const roots: string[] = [];

function tempDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "setup-agents-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("setupAgentSymlinks", () => {
  it("replaces a broken directory link", () => {
    const root = tempDir();
    const skillsDir = path.join(root, ".agents", "skills");
    const linkPath = path.join(root, ".claude", "skills");
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    fs.symlinkSync(path.join(root, "removed", "skills"), linkPath, "dir");

    setupAgentSymlinks(root);

    expect(fs.realpathSync(linkPath)).toBe(fs.realpathSync(skillsDir));
    const linkTarget = fs.readlinkSync(linkPath);
    setupAgentSymlinks(root);
    expect(fs.readlinkSync(linkPath)).toBe(linkTarget);
  });

  it("copies skills when removing a stale link is denied", () => {
    const root = tempDir();
    const skillsDir = path.join(root, ".agents", "skills");
    const linkPath = path.join(root, ".claude", "skills");
    const oldSkillsDir = path.join(root, "old-skills");
    fs.mkdirSync(path.join(skillsDir, "example"), { recursive: true });
    fs.writeFileSync(path.join(skillsDir, "example", "SKILL.md"), "skill");
    fs.mkdirSync(oldSkillsDir);
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    fs.symlinkSync(oldSkillsDir, linkPath, "dir");

    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", {
      ...platform,
      value: "linux",
    });
    const removeLink = vi.spyOn(fs, "unlinkSync").mockImplementation(() => {
      throw Object.assign(new Error("Permission denied"), { code: "EPERM" });
    });

    try {
      expect(() => setupAgentSymlinks(root)).not.toThrow();
      expect(fs.readlinkSync(linkPath)).toBe(oldSkillsDir);
      expect(
        fs.readFileSync(path.join(oldSkillsDir, "example", "SKILL.md"), "utf8"),
      ).toBe("skill");
    } finally {
      removeLink.mockRestore();
      if (platform) Object.defineProperty(process, "platform", platform);
    }
  });

  it("surfaces unexpected stale-link removal errors", () => {
    const root = tempDir();
    const linkPath = path.join(root, "skills");
    fs.symlinkSync("old-skills", linkPath, "dir");
    const failure = Object.assign(new Error("I/O failure"), { code: "EIO" });

    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", {
      ...platform,
      value: "linux",
    });
    const removeLink = vi.spyOn(fs, "unlinkSync").mockImplementation(() => {
      throw failure;
    });

    try {
      expect(() => prepareAgentSymlink(linkPath, "new-skills", "dir")).toThrow(
        failure,
      );
    } finally {
      removeLink.mockRestore();
      if (platform) Object.defineProperty(process, "platform", platform);
    }
  });

  it("removes stale Windows directory links with rmdir", () => {
    const root = tempDir();
    const linkPath = path.join(root, "skills");
    fs.symlinkSync("old-skills", linkPath, "dir");

    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", {
      ...platform,
      value: "win32",
    });
    const removeDirectory = vi
      .spyOn(fs, "rmdirSync")
      .mockImplementation(() => undefined);

    try {
      expect(prepareAgentSymlink(linkPath, "new-skills", "dir")).toBe("create");
      expect(removeDirectory).toHaveBeenCalledWith(linkPath);
    } finally {
      removeDirectory.mockRestore();
      if (platform) Object.defineProperty(process, "platform", platform);
    }
  });
});

describe("rebaseAgentSymlinkTarget", () => {
  it("maps an absolute link target from a temporary tree into the copy", () => {
    const sourceRoot = path.join(os.tmpdir(), "scaffold-source");
    const destinationRoot = path.join(os.tmpdir(), "scaffold-destination");
    const sourceLinkPath = path.join(
      sourceRoot,
      "apps",
      "chat",
      ".claude",
      "skills",
    );
    const destinationLinkPath = path.join(
      destinationRoot,
      "apps",
      "chat",
      ".claude",
      "skills",
    );
    const target = path.join(sourceRoot, "apps", "chat", ".agents", "skills");

    expect(
      rebaseAgentSymlinkTarget(
        sourceRoot,
        destinationRoot,
        sourceLinkPath,
        destinationLinkPath,
        target,
      ),
    ).toBe(path.join("..", ".agents", "skills"));
  });

  it("does not rebase a link outside the copied tree", () => {
    const sourceRoot = path.join(os.tmpdir(), "scaffold-source");
    const sourceLinkPath = path.join(sourceRoot, "apps", "chat", "link");

    expect(
      rebaseAgentSymlinkTarget(
        sourceRoot,
        path.join(os.tmpdir(), "scaffold-destination"),
        sourceLinkPath,
        path.join(os.tmpdir(), "scaffold-destination", "apps", "chat", "link"),
        path.join(os.tmpdir(), "shared", "skills"),
      ),
    ).toBeUndefined();
  });
});
